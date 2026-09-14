// ============================================================
// Gallery page logic
// ============================================================

const state = {
  source: "samples", // 'samples' | 'mine'
  format: "all", // 'all' | 'singles' | 'doubles'
  query: "",
  samples: null, // loaded lazily
};

const grid = document.getElementById("teamGrid");
const emptyState = document.getElementById("emptyState");

document.getElementById("sourceTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-source]");
  if (!btn) return;
  setActive("sourceTabs", btn);
  state.source = btn.dataset.source;
  render();
});

document.getElementById("formatTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-format]");
  if (!btn) return;
  setActive("formatTabs", btn);
  state.format = btn.dataset.format;
  render();
});

document.getElementById("searchBox").addEventListener("input", (e) => {
  state.query = e.target.value.trim().toLowerCase();
  render();
});

function setActive(groupId, btn) {
  document
    .querySelectorAll(`#${groupId} button`)
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
}

async function loadSamples() {
  if (state.samples) return state.samples;
  try {
    const idx = await fetch("data/index.json").then((r) => r.json());
    const teams = await Promise.all(
      idx.teams.map((file) =>
        fetch(`data/teams/${file}`).then((r) => {
          if (!r.ok) throw new Error(`${file} 로드 실패`);
          return r.json();
        })
      )
    );
    state.samples = teams;
  } catch (e) {
    console.error(e);
    state.samples = [];
  }
  return state.samples;
}

function matchesFilters(team) {
  if (state.format !== "all" && team.format !== state.format) return false;
  if (!state.query) return true;
  const haystack = [
    team.title,
    team.description || "",
    ...(team.pokemon || []).map((p) => p.species),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.query);
}

async function render() {
  grid.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
  const teams =
    state.source === "samples" ? await loadSamples() : PCStorage.loadLocalTeams();
  const filtered = teams.filter(matchesFilters);

  if (filtered.length === 0) {
    grid.innerHTML = "";
    emptyState.style.display = "block";
    emptyState.querySelector("h3").textContent =
      state.source === "mine" ? "아직 저장한 팀이 없어요" : "조건에 맞는 샘플이 없어요";
    emptyState.querySelector("p").textContent =
      state.source === "mine"
        ? "빌더에서 팀을 만들고 '내 브라우저에 저장'을 눌러보세요."
        : "다른 검색어나 필터를 시도해보세요.";
    return;
  }
  emptyState.style.display = "none";
  grid.innerHTML = "";
  filtered.forEach((team) => grid.appendChild(renderCard(team)));
}

function renderCard(team) {
  const card = document.createElement("div");
  card.className = `team-card format-${team.format}`;
  card.tabIndex = 0;

  const head = document.createElement("div");
  head.className = "team-card-head";
  head.innerHTML = `<h3></h3><span class="format-tag">${
    team.format === "doubles" ? "더블" : "싱글"
  }</span>`;
  head.querySelector("h3").textContent = team.title || "이름 없는 팀";
  card.appendChild(head);

  if (team.description) {
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = team.description;
    card.appendChild(desc);
  }

  const monRow = document.createElement("div");
  monRow.className = "mon-row";
  (team.pokemon || []).forEach((p) => {
    const chip = document.createElement("div");
    chip.className = "mon-chip";
    const img = document.createElement("img");
    img.alt = p.species;
    img.loading = "lazy";
    monRow.appendChild(chip);
    chip.appendChild(img);
    PC.getPokemon(p.species)
      .then((data) => {
        img.src = PC.spriteUrl(data);
      })
      .catch(() => {
        chip.textContent = "?";
      });
  });
  card.appendChild(monRow);

  const foot = document.createElement("div");
  foot.className = "team-card-foot";
  const authorText = team.author ? `by ${team.author}` : "";
  foot.innerHTML = `<span>${authorText}</span><span>${
    (team.pokemon || []).length
  }마리</span>`;
  card.appendChild(foot);

  card.addEventListener("click", () => {
    window.location.href = `builder.html?load=${encodeURIComponent(
      team.id
    )}&src=${state.source}`;
  });
  card.addEventListener("keypress", (e) => {
    if (e.key === "Enter") card.click();
  });

  return card;
}

render();
