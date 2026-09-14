// ============================================================
// Builder page logic
// ============================================================

const MAX_SLOTS = 6;
const EV_CAP_TOTAL = 510;
const EV_CAP_STAT = 252;
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];

function emptyPokemon() {
  return {
    species: "",
    nickname: "",
    ability: "",
    item: "",
    nature: "adamant",
    mega: false,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    moves: ["", "", "", ""],
  };
}

function newTeam() {
  return {
    id: null,
    title: "",
    format: "singles",
    author: "",
    description: "",
    pokemon: [],
  };
}

const state = {
  team: newTeam(),
  selected: -1,
  speciesCache: {}, // species name -> PokeAPI pokemon data
};

const rosterList = document.getElementById("rosterList");
const editorPanel = document.getElementById("editorPanel");
const statusMsg = document.getElementById("statusMsg");

document.getElementById("teamTitle").addEventListener("input", (e) => {
  state.team.title = e.target.value;
});
document.getElementById("teamFormat").addEventListener("change", (e) => {
  state.team.format = e.target.value;
});
document.getElementById("teamAuthor").addEventListener("input", (e) => {
  state.team.author = e.target.value;
});
document.getElementById("teamDesc").addEventListener("input", (e) => {
  state.team.description = e.target.value;
});

document.getElementById("addSlotBtn").addEventListener("click", () => {
  if (state.team.pokemon.length >= MAX_SLOTS) {
    setStatus("로스터는 최대 6마리까지 가능해요.");
    return;
  }
  state.team.pokemon.push(emptyPokemon());
  state.selected = state.team.pokemon.length - 1;
  renderAll();
});

document.getElementById("saveLocalBtn").addEventListener("click", () => {
  if (!validateTeam()) return;
  if (!state.team.id) state.team.id = PCStorage.makeTeamId(state.team.title);
  PCStorage.upsertLocalTeam(state.team);
  setStatus("내 브라우저에 저장했어요.");
});

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!validateTeam()) return;
  if (!state.team.id) state.team.id = PCStorage.makeTeamId(state.team.title);
  PCStorage.downloadTeamJSON(state.team);
  setStatus("JSON 파일을 내보냈어요.");
});

document.getElementById("importInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const team = await PCStorage.readTeamFile(file);
    state.team = normalizeTeam(team);
    state.selected = state.team.pokemon.length ? 0 : -1;
    renderAll();
    setStatus(`"${state.team.title}" 팀을 불러왔어요.`);
  } catch (err) {
    setStatus(err.message);
  }
  e.target.value = "";
});

function normalizeTeam(t) {
  const base = newTeam();
  return {
    ...base,
    ...t,
    pokemon: (t.pokemon || []).map((p) => ({ ...emptyPokemon(), ...p })),
  };
}

function validateTeam() {
  if (!state.team.title.trim()) {
    setStatus("팀 이름을 입력해주세요.");
    document.getElementById("teamTitle").focus();
    return false;
  }
  if (state.team.pokemon.length === 0) {
    setStatus("최소 1마리 이상 추가해주세요.");
    return false;
  }
  return true;
}

function setStatus(msg) {
  statusMsg.textContent = msg;
}

// ---------------- roster ----------------

function renderRoster() {
  rosterList.innerHTML = "";
  state.team.pokemon.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "roster-slot" + (i === state.selected ? " active" : "");
    row.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="thumb"><img alt="" /></div>
      <span class="name"></span>
      ${p.mega ? '<span class="mega-badge">MEGA</span>' : ""}
    `;
    row.querySelector(".name").textContent = p.species
      ? PC.nameToDisplay(p.nickname || p.species)
      : "빈 슬롯";
    const img = row.querySelector("img");
    if (p.species) {
      getSpeciesData(p.species).then((data) => {
        if (data) img.src = PC.spriteUrl(data);
      });
    }
    row.addEventListener("click", () => {
      state.selected = i;
      renderAll();
    });
    rosterList.appendChild(row);
  });
}

// ---------------- editor ----------------

async function getSpeciesData(name) {
  if (!name) return null;
  if (state.speciesCache[name]) return state.speciesCache[name];
  try {
    const data = await PC.getPokemon(name);
    state.speciesCache[name] = data;
    return data;
  } catch (e) {
    return null;
  }
}

function renderEditor() {
  if (state.selected < 0 || !state.team.pokemon[state.selected]) {
    editorPanel.innerHTML = `
      <div class="empty-state">
        <h3>포켓몬을 추가해보세요</h3>
        <p>왼쪽의 "포켓몬 추가" 버튼으로 로스터에 슬롯을 만들 수 있습니다.</p>
      </div>`;
    return;
  }

  const p = state.team.pokemon[state.selected];

  editorPanel.innerHTML = `
    <div class="field-grid">
      <div class="field">
        <label for="fSpecies">포켓몬 (종족명, 영문)</label>
        <input type="text" id="fSpecies" list="speciesOptions" value="${escapeAttr(
          p.species
        )}" placeholder="예: charizard" />
        <datalist id="speciesOptions"></datalist>
      </div>
      <div class="field">
        <label for="fNickname">별명 (선택)</label>
        <input type="text" id="fNickname" value="${escapeAttr(p.nickname)}" />
      </div>
    </div>

    <div class="field-grid">
      <div class="field">
        <label for="fAbility">특성</label>
        <select id="fAbility"><option value="">먼저 포켓몬을 선택하세요</option></select>
      </div>
      <div class="field">
        <label for="fItem">지닌 물건</label>
        <select id="fItem"></select>
      </div>
    </div>

    <div class="field-grid">
      <div class="field">
        <label for="fNature">성격</label>
        <select id="fNature"></select>
      </div>
      <div class="field" style="align-self:end;">
        <label class="mega-toggle" style="margin:0;">
          <input type="checkbox" id="fMega" ${p.mega ? "checked" : ""} />
          메가진화 (팀당 1마리만 가능)
        </label>
      </div>
    </div>

    <div class="section-title">기술 (최대 4개)</div>
    <div class="moves-grid" id="movesGrid"></div>

    <div class="section-title">노력치 (EV) · 최대 252 / 합계 510</div>
    <div id="evGrid"></div>
    <div class="ev-total" id="evTotal"></div>

    <div class="action-row" style="border-top:none;padding-top:0;margin-top:24px;">
      <button class="btn secondary" id="removeSlotBtn">이 슬롯 삭제</button>
    </div>
  `;

  // species input
  const speciesInput = document.getElementById("fSpecies");
  const speciesOptions = document.getElementById("speciesOptions");
  let debounce;
  speciesInput.addEventListener("input", (e) => {
    clearTimeout(debounce);
    const q = e.target.value;
    debounce = setTimeout(async () => {
      const matches = await PC.searchSpecies(q);
      speciesOptions.innerHTML = matches
        .map((m) => `<option value="${m}"></option>`)
        .join("");
    }, 200);
  });
  speciesInput.addEventListener("change", async (e) => {
    const name = e.target.value.trim().toLowerCase();
    const data = await getSpeciesData(name);
    if (!data) {
      setStatus(`"${name}" 포켓몬을 찾을 수 없어요.`);
      return;
    }
    p.species = name;
    p.ability = "";
    p.moves = ["", "", "", ""];
    setStatus("");
    renderRoster();
    populateAbilityAndMoves(p, data);
  });

  // nickname
  document.getElementById("fNickname").addEventListener("input", (e) => {
    p.nickname = e.target.value;
    renderRoster();
  });

  // item select
  const itemSelect = document.getElementById("fItem");
  itemSelect.innerHTML =
    `<option value="">(없음)</option>` +
    PC.HELD_ITEMS.map(
      (it) =>
        `<option value="${it}" ${it === p.item ? "selected" : ""}>${PC.nameToDisplay(
          it
        )}</option>`
    ).join("");
  itemSelect.addEventListener("change", (e) => (p.item = e.target.value));

  // nature select
  const natureSelect = document.getElementById("fNature");
  natureSelect.innerHTML = Object.keys(PC.NATURES)
    .map((n) => {
      const mod = PC.NATURES[n];
      const label = mod.up
        ? `${PC.nameToDisplay(n)} (${PC.STAT_LABEL[mod.up]}↑ ${PC.STAT_LABEL[mod.down]}↓)`
        : `${PC.nameToDisplay(n)} (변화 없음)`;
      return `<option value="${n}" ${n === p.nature ? "selected" : ""}>${label}</option>`;
    })
    .join("");
  natureSelect.addEventListener("change", (e) => (p.nature = e.target.value));

  // mega toggle — only one per team
  document.getElementById("fMega").addEventListener("change", (e) => {
    if (e.target.checked) {
      state.team.pokemon.forEach((mon, i) => {
        if (i !== state.selected) mon.mega = false;
      });
    }
    p.mega = e.target.checked;
    renderRoster();
  });

  // remove slot
  document.getElementById("removeSlotBtn").addEventListener("click", () => {
    state.team.pokemon.splice(state.selected, 1);
    state.selected = state.team.pokemon.length ? 0 : -1;
    renderAll();
  });

  renderEvGrid(p);

  // if species already known, populate ability/move lists
  if (p.species) {
    getSpeciesData(p.species).then((data) => {
      if (data) populateAbilityAndMoves(p, data, true);
    });
  } else {
    renderMovesGrid(p, []);
  }
}

async function populateAbilityAndMoves(p, data, preserveSelection = false) {
  const abilities = await PC.getAbilitiesFor(data);
  const abilitySelect = document.getElementById("fAbility");
  if (abilitySelect) {
    abilitySelect.innerHTML = abilities
      .map(
        (a) =>
          `<option value="${a}" ${a === p.ability ? "selected" : ""}>${PC.nameToDisplay(
            a
          )}</option>`
      )
      .join("");
    if (!preserveSelection || !abilities.includes(p.ability)) {
      p.ability = abilities[0] || "";
      abilitySelect.value = p.ability;
    }
    abilitySelect.onchange = (e) => (p.ability = e.target.value);
  }

  const moves = await PC.getMovesFor(data);
  renderMovesGrid(p, moves);
}

function renderMovesGrid(p, movePool) {
  const grid = document.getElementById("movesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = `기술 ${i + 1}`;
    const select = document.createElement("select");
    select.innerHTML =
      `<option value="">(선택 안함)</option>` +
      movePool
        .map(
          (m) =>
            `<option value="${m}" ${m === p.moves[i] ? "selected" : ""}>${PC.nameToDisplay(
              m
            )}</option>`
        )
        .join("");
    if (movePool.length === 0) select.disabled = true;
    select.addEventListener("change", (e) => {
      p.moves[i] = e.target.value;
    });
    field.appendChild(label);
    field.appendChild(select);
    grid.appendChild(field);
  }
}

function renderEvGrid(p) {
  const evGrid = document.getElementById("evGrid");
  evGrid.innerHTML = "";
  STAT_KEYS.forEach((key) => {
    const row = document.createElement("div");
    row.className = "ev-row";
    row.innerHTML = `
      <span class="stat-label">${PC.STAT_LABEL[key]}</span>
      <input type="range" min="0" max="${EV_CAP_STAT}" step="4" value="${p.evs[key]}" />
      <span class="ev-val">${p.evs[key]}</span>
    `;
    const range = row.querySelector("input");
    const val = row.querySelector(".ev-val");
    range.addEventListener("input", (e) => {
      p.evs[key] = Number(e.target.value);
      val.textContent = p.evs[key];
      updateEvTotal(p);
    });
    evGrid.appendChild(row);
  });
  updateEvTotal(p);
}

function updateEvTotal(p) {
  const total = STAT_KEYS.reduce((sum, k) => sum + p.evs[k], 0);
  const el = document.getElementById("evTotal");
  el.textContent = `합계: ${total} / ${EV_CAP_TOTAL}`;
  el.classList.toggle("over", total > EV_CAP_TOTAL);
}

function escapeAttr(s) {
  return (s || "").replace(/"/g, "&quot;");
}

function renderAll() {
  renderRoster();
  renderEditor();
}

// ---------------- initial load from query string ----------------

async function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const loadId = params.get("load");
  const src = params.get("src");
  if (!loadId) {
    renderAll();
    return;
  }
  try {
    let team;
    if (src === "mine") {
      team = PCStorage.loadLocalTeams().find((t) => t.id === loadId);
    } else {
      const idx = await fetch("data/index.json").then((r) => r.json());
      for (const file of idx.teams) {
        const t = await fetch(`data/teams/${file}`).then((r) => r.json());
        if (t.id === loadId) {
          team = t;
          break;
        }
      }
    }
    if (team) {
      state.team = normalizeTeam(team);
      state.selected = state.team.pokemon.length ? 0 : -1;
      document.getElementById("teamTitle").value = state.team.title;
      document.getElementById("teamFormat").value = state.team.format;
      document.getElementById("teamAuthor").value = state.team.author || "";
      document.getElementById("teamDesc").value = state.team.description || "";
      document.getElementById("pageTitle").textContent = "팀 수정";
    }
  } catch (e) {
    console.error(e);
  }
  renderAll();
}

initFromQuery();
