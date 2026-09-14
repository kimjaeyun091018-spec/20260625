// ============================================================
// Local team storage — personal builds live in localStorage.
// Public "sample" teams live as committed JSON files under
// data/teams/, listed in data/index.json (see gallery.js).
// ============================================================

const LOCAL_KEY = "pc_my_teams";

function loadLocalTeams() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("내 팀을 불러오지 못했습니다", e);
    return [];
  }
}

function saveLocalTeams(teams) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(teams));
}

function upsertLocalTeam(team) {
  const teams = loadLocalTeams();
  const idx = teams.findIndex((t) => t.id === team.id);
  if (idx >= 0) teams[idx] = team;
  else teams.unshift(team);
  saveLocalTeams(teams);
}

function deleteLocalTeam(id) {
  saveLocalTeams(loadLocalTeams().filter((t) => t.id !== id));
}

function slugify(str) {
  return (
    str
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/(^-|-$)/g, "") || "team"
  );
}

function makeTeamId(title) {
  return `${slugify(title)}-${Date.now().toString(36)}`;
}

function downloadTeamJSON(team) {
  const blob = new Blob([JSON.stringify(team, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(team.title)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readTeamFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (e) {
        reject(new Error("올바른 팀 JSON 파일이 아닙니다"));
      }
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다"));
    reader.readAsText(file);
  });
}

window.PCStorage = {
  loadLocalTeams,
  saveLocalTeams,
  upsertLocalTeam,
  deleteLocalTeam,
  makeTeamId,
  slugify,
  downloadTeamJSON,
  readTeamFile,
};
