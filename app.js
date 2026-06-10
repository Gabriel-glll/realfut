/* =====================================================================
   REAL FUT — app.js
   HTML/CSS/JS puro + Firebase Firestore (dados compartilhados em tempo real).

   MODO TESTE: abra a página com ?demo=1 no final do endereço
   (ex.: index.html?demo=1) para um ambiente de mentira, com dados de
   exemplo, horário liberado e nada salvo no banco real.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc,
  deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================================================================
   1) COLE AQUI SUAS CHAVES DO FIREBASE
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyAbhBYFPNa1vuCnluVN1MSkvEAWlOTpyss",
  authDomain: "real-fut.firebaseapp.com",
  projectId: "real-fut",
  storageBucket: "real-fut.firebasestorage.app",
  messagingSenderId: "610172898162",
  appId: "1:610172898162:web:077b32032e0f6002526beb",
  measurementId: "G-69ZN50Q88T"
};
/* ===================================================================== */

/* Senhas do site */
const SENHA_CADASTRO = "realfut";  // para cadastrar jogador
const SENHA_ADMIN    = "futreal";  // para sortear times e zerar a lista

/* Temporada */
const TEMPORADA_INICIO = "2026-06-01";
const TEMPORADA_FIM    = "2026-12-31";

/* Pontuação por ação */
const PONTOS = { win: 8, goal: 5, assist: 3, gaia: 2, yellow: -3 };
const ROTULO = {
  win: "Vitória", goal: "Gol", assist: "Assistência",
  gaia: "Gaia/Rolinho", yellow: "Cartão amarelo"
};

const LIMITE_LISTA = 20;

/* MODO TESTE liga com ?demo=1 (ou ?demo) no endereço */
const DEMO = new URLSearchParams(location.search).has("demo");

/* =====================================================================
   2) FIREBASE x MODO TESTE (banco real vs banco de mentira na memória)
   ===================================================================== */
let db = null;
const semChaves = firebaseConfig.apiKey === "COLE_AQUI";
if (!DEMO) {
  if (semChaves) document.getElementById("firebaseWarning").classList.remove("hidden");
  else { db = getFirestore(initializeApp(firebaseConfig)); }
}
/* true quando NÃO dá pra gravar (firebase sem chave e fora do teste) */
const bloqueado = !DEMO && semChaves;

/* ---- Banco de mentira em memória (só no MODO TESTE) ---- */
const mem  = { players: {}, votes: {}, listEntries: {}, actions: {} };
const subs = { players: [], votes: [], listEntries: [], actions: [] };
const memArray = (c) => Object.entries(mem[c]).map(([id, d]) => ({ id, ...d }));
const memEmit  = (c) => subs[c].forEach(cb => cb(memArray(c)));

/* Carimbo de tempo: real usa serverTimestamp, teste usa um objeto simples */
const stamp = () => DEMO ? { seconds: Date.now() / 1000 } : serverTimestamp();

/* Camada de dados única (decide entre Firestore e memória) */
async function dbSet(col, id, data) {
  if (DEMO) { mem[col][id] = data; memEmit(col); return; }
  await setDoc(doc(collection(db, col), id), data);
}
async function dbDelete(col, id) {
  if (DEMO) { delete mem[col][id]; memEmit(col); return; }
  await deleteDoc(doc(collection(db, col), id));
}
function dbWatch(col, cb) {
  if (DEMO) { subs[col].push(cb); cb(memArray(col)); return; }
  onSnapshot(collection(db, col), (snap) =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

/* =====================================================================
   3) ESTADO LOCAL + SESSÃO
   ===================================================================== */
const SESSION_KEY = DEMO ? "realfut_me_demo" : "realfut_me";
const state = {
  players: [], votes: [], listEntries: [], actions: [],
  meId: localStorage.getItem(SESSION_KEY) || null
};

/* =====================================================================
   4) HORÁRIO DE BRASÍLIA
   ===================================================================== */
function brasiliaParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return m;
}
function cicloAtual() {
  const p = brasiliaParts();
  const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12));
  const add = (3 - base.getUTCDay() + 7) % 7; // dias até quarta
  base.setUTCDate(base.getUTCDate() + add);
  return base.toISOString().slice(0, 10);
}
function hojeKey() {
  const p = brasiliaParts();
  return `${p.year}-${p.month}-${p.day}`;
}
/* Quarta, 19:50–23h. No MODO TESTE fica sempre aberta. */
function quadraAberta() {
  if (DEMO) return true;
  const p = brasiliaParts();
  const min = (+p.hour) * 60 + (+p.minute);
  return p.weekday === "Wed" && min >= (19 * 60 + 50) && min < (23 * 60);
}
function ddmm(key) {
  if (!key) return "";
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/* =====================================================================
   5) HELPERS
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const fotoOuPadrao = (p) =>
  (p && p.photo) ? p.photo
  : "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' rx='40' fill='#2b3a30'/><text x='50%' y='58%' font-size='34' text-anchor='middle' fill='#9fb0a6' font-family='Arial'>⚽</text></svg>`
    );
const meuJogador = () => state.players.find(p => p.id === state.meId) || null;
const precisaLogin = (msg) => alert(msg || "Entre na sua conta primeiro!");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Hash SHA-256 da senha (nunca guardamos a senha em texto puro) */
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* =====================================================================
   6) NAVEGAÇÃO
   ===================================================================== */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.view).classList.add("active");
  });
});

/* =====================================================================
   7) REGRAS (estáticas)
   ===================================================================== */
const REGRAS = [
  "Todos ajudar nas reservas de quarta.",
  "Chamar convidados somente quando a lista não estiver cheia.",
  "Ter colete dupla face Azul e Amarelo.",
  "A partida é de 10 min ou 3 gols.",
  "O tempo é registrado pelo cronômetro, não por olho.",
  "O tempo só conta com bola rolando; troca de time e faltas demoradas o tempo é pausado.",
  "Rei da quadra: ganhou, fica jogando.",
  "Empate é vitória para quem entrou; quem já estava tem obrigação de ganhar.",
  "Apenas pessoas no lance podem questionar a falta/lateral/escanteio."
];
$("#rulesList").innerHTML = REGRAS.map(r => `<li>${r}</li>`).join("");

/* =====================================================================
   8) CADASTRO (com senha pessoal)
   ===================================================================== */
let fotoBase64 = "";
$("#btnOpenRegister").addEventListener("click", () => openModal("registerModal"));
$("#regPhoto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fotoBase64 = await comprimirImagem(file);
  const prev = $("#regPreview");
  prev.src = fotoBase64; prev.classList.remove("hidden");
});
function comprimirImagem(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      let { width, height } = img;
      if (width > height && width > max) { height = height * max / width; width = max; }
      else if (height > max) { width = width * max / height; height = max; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.src = URL.createObjectURL(file);
  });
}
$("#btnDoRegister").addEventListener("click", async () => {
  if (bloqueado) return alert("Configure o Firebase primeiro (veja o aviso no topo).");
  const pass = $("#regPass").value.trim();
  const name = $("#regName").value.trim();
  const nick = $("#regNick").value.trim();
  const userPass = $("#regUserPass").value;
  const gk = $("#regGK").checked;
  const err = $("#regError"); err.textContent = "";

  if (pass !== SENHA_CADASTRO) return err.textContent = "Senha de cadastro incorreta.";
  if (!name || !nick) return err.textContent = "Preencha nome e apelido.";
  if (!userPass || userPass.length < 3) return err.textContent = "Crie uma senha pessoal (mín. 3 caracteres).";
  if (state.players.some(p => p.nick.toLowerCase() === nick.toLowerCase()))
    return err.textContent = "Esse apelido já existe.";

  const id = "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const passwordHash = await sha256(userPass);
  await dbSet("players", id, {
    name, nick, gk, photo: fotoBase64 || "", passwordHash, createdAt: stamp()
  });

  setMe(id); // já entra logado
  fotoBase64 = "";
  $("#regPass").value = $("#regName").value = $("#regNick").value = $("#regUserPass").value = "";
  $("#regGK").checked = false;
  $("#regPreview").classList.add("hidden");
  closeModals();
});

/* =====================================================================
   9) LOGIN / LOGOUT (com senha pessoal — ninguém entra no seu nome)
   ===================================================================== */
$("#btnOpenLogin").addEventListener("click", () => {
  const sel = $("#loginSelect");
  sel.innerHTML = state.players.length
    ? state.players.map(p => `<option value="${p.id}">${p.name} (${p.nick})</option>`).join("")
    : `<option value="">Ninguém cadastrado ainda</option>`;
  $("#loginPass").value = "";
  $("#loginError").textContent = "";
  openModal("loginModal");
});
$("#btnDoLogin").addEventListener("click", async () => {
  const id = $("#loginSelect").value;
  const err = $("#loginError"); err.textContent = "";
  if (!id) return err.textContent = "Cadastre-se primeiro.";
  const p = state.players.find(x => x.id === id);
  const pw = $("#loginPass").value;
  if (!pw) return err.textContent = "Digite sua senha.";

  const h = await sha256(pw);
  if (p.passwordHash) {
    if (p.passwordHash !== h) return err.textContent = "Senha incorreta.";
  } else {
    // conta antiga (criada antes da senha): define a senha agora
    const { id: _omit, ...data } = p;
    await dbSet("players", p.id, { ...data, passwordHash: h });
  }
  setMe(p.id);
  closeModals();
});
$("#btnLogout").addEventListener("click", () => setMe(null));

function setMe(id) {
  state.meId = id;
  if (id) localStorage.setItem(SESSION_KEY, id);
  else localStorage.removeItem(SESSION_KEY);
  renderTudo();
}

/* =====================================================================
   10) VOTAÇÃO (com justificativa pública para quem NÃO concorda)
   ===================================================================== */
$("#btnAgree").addEventListener("click", () => votar(true));
$("#btnDisagree").addEventListener("click", () => abrirJustificativa());

async function votar(agree, justification = "") {
  if (bloqueado) return alert("Configure o Firebase primeiro.");
  const me = meuJogador();
  if (!me) return precisaLogin("Entre na sua conta para votar.");
  await dbSet("votes", me.id, {
    playerId: me.id, nick: me.nick, agree, justification, updatedAt: stamp()
  });
}
function abrirJustificativa() {
  const me = meuJogador();
  if (!me) return precisaLogin("Entre na sua conta para votar.");
  const meu = state.votes.find(v => v.id === me.id);
  $("#voteJustifInput").value = (meu && !meu.agree) ? (meu.justification || "") : "";
  $("#voteError").textContent = "";
  openModal("voteModal");
}
$("#btnVoteOk").addEventListener("click", async () => {
  const txt = $("#voteJustifInput").value.trim();
  if (!txt) return $("#voteError").textContent = "Escreva qual regra e por quê (todos vão ver).";
  await votar(false, txt);
  closeModals();
});

/* =====================================================================
   11) LISTA DA QUARTA
   ===================================================================== */
$("#joinCheckbox").addEventListener("change", async (e) => {
  if (bloqueado) { e.target.checked = false; return alert("Configure o Firebase primeiro."); }
  const me = meuJogador();
  if (!me) { e.target.checked = false; return precisaLogin("Entre na sua conta para entrar na lista."); }

  const ciclo = cicloAtual();
  const atuais = state.listEntries.filter(l => l.cycleKey === ciclo);

  if (e.target.checked) {
    if (atuais.length >= LIMITE_LISTA && !atuais.some(l => l.id === me.id)) {
      e.target.checked = false;
      return alert("🔒 Lista cheia! Já tem 20 jogadores.");
    }
    await dbSet("listEntries", me.id, {
      playerId: me.id, nick: me.nick, photo: me.photo || "",
      cycleKey: ciclo, joinedAt: stamp()
    });
  } else {
    await dbDelete("listEntries", me.id);
  }
});
$("#btnResetList").addEventListener("click", () => {
  pedirSenha("Zerar lista", SENHA_ADMIN, async () => {
    const ciclo = cicloAtual();
    const atuais = state.listEntries.filter(l => l.cycleKey === ciclo);
    await Promise.all(atuais.map(l => dbDelete("listEntries", l.id)));
    alert("Lista zerada! ✅");
  });
});

/* =====================================================================
   12) SORTEIO DE TIMES
   ===================================================================== */
$("#btnDraw").addEventListener("click", () => {
  pedirSenha("Sortear times", SENHA_ADMIN, () => sortearTimes());
});
function embaralhar(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sortearTimes() {
  const ciclo = cicloAtual();
  const naLista = state.listEntries
    .filter(l => l.cycleKey === ciclo)
    .map(l => state.players.find(p => p.id === l.id))
    .filter(Boolean);

  if (naLista.length < 5) {
    $("#drawResult").innerHTML = `<div class="gk-note">Precisa de pelo menos 5 jogadores na lista. Hoje tem ${naLista.length}.</div>`;
    return;
  }
  const goleirosFixos = embaralhar(naLista.filter(p => p.gk));
  const linha = embaralhar(naLista.filter(p => !p.gk));
  const nTimes = Math.min(4, Math.floor(linha.length / 5));
  if (nTimes === 0) {
    $("#drawResult").innerHTML = `<div class="gk-note">Não dá pra fechar nenhum time de 5 jogadores de linha (tem ${linha.length}).</div>`;
    return;
  }
  const cores = ["team-azul", "team-amarelo", "team-verde", "team-branco"];
  const nomes = ["Azul", "Amarelo", "Verde", "Branco"];
  const times = [];
  let idx = 0;
  for (let t = 0; t < nTimes; t++) {
    const jogadores = linha.slice(idx, idx + 5);
    idx += 5;
    const golFixo = goleirosFixos.length ? goleirosFixos.shift() : null;
    times.push({ nome: nomes[t], cor: cores[t], jogadores, golFixo });
  }
  const sobras = [...linha.slice(idx), ...goleirosFixos];

  let html = `<div class="teams-grid">`;
  for (const t of times) {
    html += `<div class="team ${t.cor}">
      <h4>Time ${t.nome}</h4>
      <ul>
        ${t.golFixo ? `<li class="gk">🧤 ${t.golFixo.nick} <small>(goleiro fixo)</small></li>` : ``}
        ${t.jogadores.map(j => `<li>${j.nick}</li>`).join("")}
      </ul>
    </div>`;
  }
  html += `</div>`;
  html += `<div class="gk-note">
    <b>🧤 Goleiro emprestado (revezamento):</b>
    Como vale "rei da quadra", só 2 times jogam por vez. Quem está de fora reveza no gol
    dos times que <u>não</u> têm goleiro fixo, na ordem abaixo:
    ${sobras.length
      ? `<ul>${sobras.map(s => `<li>${s.nick}</li>`).join("")}</ul>`
      : `<p>(Sem jogadores de fora agora — combinem o rodízio na hora.)</p>`}
  </div>`;
  $("#drawResult").innerHTML = html;
}

/* =====================================================================
   13) REGISTRAR AÇÕES (Scores)
   ===================================================================== */
document.querySelectorAll(".btn.act").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (bloqueado) return alert("Configure o Firebase primeiro.");
    const me = meuJogador();
    if (!me) return precisaLogin("Entre na sua conta para lançar ações.");
    if (!quadraAberta()) return mostrarFeedback("🔒 A quadra tá fechada! Volta quarta às 19:50.", true);

    const type = btn.dataset.type;
    const id = "a_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await dbSet("actions", id, {
      playerId: me.id, nick: me.nick, type,
      points: PONTOS[type], dateKey: hojeKey(), createdAt: stamp()
    });
    mostrarFeedback(`${ROTULO[type]} lançado! ${PONTOS[type] > 0 ? "+" : ""}${PONTOS[type]} pts 🎉`);
  });
});
function mostrarFeedback(msg, erro = false) {
  const el = $("#actionFeedback");
  el.textContent = msg;
  el.style.color = erro ? "var(--vermelho)" : "var(--verde)";
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}
$("#btnRefresh").addEventListener("click", () => {
  renderScores();
  mostrarFeedback("Ranking atualizado! 🔄");
});

/* =====================================================================
   14) RANKING / SCORES
   ===================================================================== */
const acoesDaTemporada = () =>
  state.actions.filter(a => a.dateKey >= TEMPORADA_INICIO && a.dateKey <= TEMPORADA_FIM);

function calcularRanking() {
  const pontos = {};
  for (const a of acoesDaTemporada()) pontos[a.playerId] = (pontos[a.playerId] || 0) + a.points;
  return state.players
    .map(p => ({ ...p, pts: pontos[p.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);
}
function renderScores() {
  const rank = calcularRanking();
  const podium = $("#podium");
  const top3 = rank.slice(0, 3);
  if (top3.length && top3[0].pts > 0) {
    const classes = ["first", "second", "third"];
    const coroa = ["👑", "🥈", "🥉"];
    podium.innerHTML = top3.map((p, i) => `
      <div class="pod ${classes[i]}">
        <span class="crown">${coroa[i]}</span>
        <img src="${fotoOuPadrao(p)}" alt="">
        <span class="pnick">${p.nick}</span>
        <span class="ppts">${p.pts} pts</span>
      </div>`).join("");
  } else {
    podium.innerHTML = `<p class="muted">Ainda não há pontos. Bora jogar! ⚽</p>`;
  }
  $("#rankBody").innerHTML = rank.map((p, i) => `
    <tr>
      <td>${i + 1}º</td>
      <td><div class="rank-player"><img src="${fotoOuPadrao(p)}" alt="">${p.nick}</div></td>
      <td>${p.pts}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">Sem jogadores ainda.</td></tr>`;
  renderResumos();
  renderStatusTemporada();
}
function renderResumos() {
  const porData = {};
  for (const a of acoesDaTemporada()) (porData[a.dateKey] = porData[a.dateKey] || []).push(a);
  const datas = Object.keys(porData).sort().reverse();
  const cont = $("#matchSummaries");
  if (!datas.length) { cont.innerHTML = `<p class="muted">Nenhuma quarta registrada ainda.</p>`; return; }
  cont.innerHTML = datas.map(d => {
    const acoes = porData[d];
    const tipos = {};
    for (const a of acoes) (tipos[a.type] = tipos[a.type] || []).push(a.nick);
    const linha = (tipo, emoji) => tipos[tipo]
      ? `<span class="tag">${emoji} ${ROTULO[tipo]}: ${tipos[tipo].join(", ")}</span>` : "";
    const somaDia = {};
    for (const a of acoes) somaDia[a.nick] = (somaDia[a.nick] || 0) + a.points;
    const craque = Object.entries(somaDia).sort((x, y) => y[1] - x[1])[0];
    return `<div class="match">
      <h4>📅 Quarta ${ddmm(d)} ${craque ? `— Craque: <b>${craque[0]}</b> (${craque[1]} pts)` : ""}</h4>
      <div class="line">
        ${linha("goal", "⚽")}${linha("assist", "🅰️")}${linha("win", "🏅")}
        ${linha("gaia", "😂")}${linha("yellow", "🟨")}
      </div>
    </div>`;
  }).join("");
}
function renderStatusTemporada() {
  const hoje = hojeKey();
  const el = $("#seasonStatus");
  if (hoje < TEMPORADA_INICIO) el.textContent = "⏳ Temporada ainda não começou.";
  else if (hoje > TEMPORADA_FIM) el.textContent = "🏁 Temporada encerrada — confira os campeões!";
  else el.textContent = "🔥 Temporada em andamento!";
}

/* =====================================================================
   15) CARD COMEMORATIVO
   ===================================================================== */
$("#btnMakeCard").addEventListener("click", () => {
  const rank = calcularRanking().filter(p => p.pts > 0).slice(0, 3);
  if (!rank.length) return alert("Ainda não há pontuação para gerar o card.");
  const pos = ["🥇", "🥈", "🥉"];
  $("#championCard").innerHTML = `
    <h3>🏆 Campeões Real Fut</h3>
    <div class="sub">Temporada 01/06/2026 — 31/12/2026</div>
    ${rank.map((p, i) => `
      <div class="champ-row">
        <span class="pos">${pos[i]}</span>
        <img src="${fotoOuPadrao(p)}" alt="">
        <span class="who"><b>${p.nick}</b>${p.pts} pontos</span>
      </div>`).join("")}
  `;
  $("#championCardWrap").classList.remove("hidden");
});
$("#btnDownloadCard").addEventListener("click", async () => {
  const canvas = await html2canvas($("#championCard"), { backgroundColor: null, scale: 2 });
  const link = document.createElement("a");
  link.download = "campeoes-real-fut.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

/* =====================================================================
   16) MODAIS
   ===================================================================== */
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden")); }
document.querySelectorAll(".closeModal").forEach(b => b.addEventListener("click", closeModals));
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", (e) => { if (e.target === m) closeModals(); });
});
let acaoSenha = null;
function pedirSenha(titulo, senhaCerta, onOk) {
  $("#passTitle").textContent = titulo;
  $("#passInput").value = "";
  $("#passError").textContent = "";
  acaoSenha = { senhaCerta, onOk };
  openModal("passModal");
}
$("#btnPassOk").addEventListener("click", () => {
  if (!acaoSenha) return;
  if ($("#passInput").value.trim() !== acaoSenha.senhaCerta)
    return $("#passError").textContent = "Senha incorreta.";
  const fn = acaoSenha.onOk; acaoSenha = null;
  closeModals(); fn();
});

/* =====================================================================
   17) RENDER
   ===================================================================== */
function renderLogin() {
  const me = meuJogador();
  $("#loggedOut").classList.toggle("hidden", !!me);
  $("#loggedIn").classList.toggle("hidden", !me);
  if (me) { $("#meNick").textContent = me.nick; $("#meAvatar").src = fotoOuPadrao(me); }
}
function renderVotacao() {
  const simVotos = state.votes.filter(v => v.agree);
  const naoVotos = state.votes.filter(v => !v.agree);
  const total = simVotos.length + naoVotos.length;
  $("#countAgree").textContent = simVotos.length;
  $("#countDisagree").textContent = naoVotos.length;
  $("#barAgree").style.width = total ? `${(simVotos.length / total) * 100}%` : "50%";
  $("#barDisagree").style.width = total ? `${(naoVotos.length / total) * 100}%` : "50%";

  const avatares = (votos) => votos.map(v => {
    const p = state.players.find(x => x.id === v.id);
    return `<img src="${fotoOuPadrao(p)}" title="${p ? p.nick : "?"}" alt="">`;
  }).join("");
  $("#avatarsAgree").innerHTML = avatares(simVotos);
  $("#avatarsDisagree").innerHTML = avatares(naoVotos);

  // justificativas públicas de quem não concordou
  const comTexto = naoVotos.filter(v => v.justification);
  $("#voteJustifications").innerHTML = comTexto.length
    ? `<div class="justifs-title">📣 Quem não concordou explicou:</div>` +
      comTexto.map(v => {
        const p = state.players.find(x => x.id === v.id);
        const nick = p ? p.nick : (v.nick || "?");
        return `<div class="justif">
          <img src="${fotoOuPadrao(p)}" alt="">
          <div><b>${escapeHtml(nick)}</b><span>${escapeHtml(v.justification)}</span></div>
        </div>`;
      }).join("")
    : "";

  const me = meuJogador();
  const meu = me && state.votes.find(v => v.id === me.id);
  $("#voteHint").textContent = !me
    ? "Entre na sua conta para votar (pode trocar)."
    : meu ? `Seu voto: ${meu.agree ? "👍 Concordo" : "👎 Não concordo"} (pode trocar).`
          : "Você ainda não votou.";
}
function renderLista() {
  const ciclo = cicloAtual();
  $("#cycleDate").textContent = ddmm(ciclo);
  const atuais = state.listEntries
    .filter(l => l.cycleKey === ciclo)
    .sort((a, b) => (a.joinedAt?.seconds || 0) - (b.joinedAt?.seconds || 0));

  $("#listCount").textContent = atuais.length;
  $("#listLeft").textContent = Math.max(0, LIMITE_LISTA - atuais.length);
  $("#listFull").classList.toggle("hidden", atuais.length < LIMITE_LISTA);

  const me = meuJogador();
  $("#joinCheckbox").checked = !!(me && atuais.some(l => l.id === me.id));
  $("#joinCheckbox").disabled = !me;

  $("#wedList").innerHTML = atuais.map(l => {
    const p = state.players.find(x => x.id === l.id);
    const ehMe = me && l.id === me.id;
    return `<li>
      <img class="ava" src="${fotoOuPadrao(p)}" alt="">
      <b>${escapeHtml(l.nick)}</b>
      ${ehMe ? `<span class="me-flag">você</span>` : ""}
    </li>`;
  }).join("") || `<li style="background:none;border:none">Ninguém na lista ainda. Seja o primeiro! ⚽</li>`;
}
function renderJanela() {
  const aberta = quadraAberta();
  const banner = $("#windowBanner");
  banner.classList.toggle("open", aberta);
  banner.classList.toggle("closed", !aberta);
  $("#windowText").textContent = aberta
    ? (DEMO ? "🧪 MODO TESTE: quadra sempre aberta pra você testar à vontade."
            : "🟢 QUADRA ABERTA! Pode lançar suas ações até as 23h.")
    : "🔴 Quadra fechada. Ações só nas quartas, das 19:50 às 23h (horário de Brasília).";

  const me = meuJogador();
  $("#actionWho").classList.toggle("hidden", !!me);
  $("#actionPanel").classList.toggle("hidden", !me);
  document.querySelectorAll(".btn.act").forEach(b => b.disabled = !aberta);
}
function renderTudo() {
  renderLogin(); renderVotacao(); renderLista(); renderJanela(); renderScores();
}

/* =====================================================================
   18) DADOS DE TESTE (só no MODO TESTE)
   ===================================================================== */
function demoAvatar(letra, cor) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' rx='40' fill='${cor}'/><text x='50%' y='58%' font-size='40' text-anchor='middle' fill='#fff' font-family='Arial' font-weight='bold'>${letra}</text></svg>`);
}
function seedDemo() {
  const HASH_123 = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"; // sha256("123")
  const defs = [
    ["Gabriel Gil", "Gil", "#009739", false],
    ["Rafael Souza", "Rafa", "#2f6bff", false],
    ["Bruno Lima", "Brunão", "#ff8c00", false],
    ["Thiago Alves", "Thiagão", "#9b2fff", false],
    ["Pedro Henrique", "Pedrinho", "#e6005c", false],
    ["Lucas Dias", "Luquinha", "#00b8a9", false],
    ["Marcos Paulo", "Marcão", "#555f6b", true],   // goleiro fixo
    ["Diego Santos", "Dieguito", "#c0392b", false]
  ];
  const ids = [];
  defs.forEach((d, i) => {
    const id = "demo_p" + i; ids.push(id);
    mem.players[id] = {
      name: d[0], nick: d[1], gk: d[3],
      photo: demoAvatar(d[1][0], d[2]), passwordHash: HASH_123, createdAt: { seconds: 1000 + i }
    };
  });
  const vote = (i, agree, justification = "") => {
    const pid = ids[i];
    mem.votes[pid] = { playerId: pid, nick: mem.players[pid].nick, agree, justification, updatedAt: { seconds: 2000 + i } };
  };
  vote(0, true); vote(1, true); vote(4, true); vote(5, true);
  vote(2, false, "Discordo da regra 4: 10 min é pouco, devia ser 12 minutos por partida.");
  vote(3, false, "Regra 8 é injusta — empate devia ser empate, ninguém leva vantagem.");

  const ciclo = cicloAtual();
  [0, 1, 2, 3, 4, 5, 6].forEach((i, k) => {
    const pid = ids[i];
    mem.listEntries[pid] = {
      playerId: pid, nick: mem.players[pid].nick, photo: mem.players[pid].photo,
      cycleKey: ciclo, joinedAt: { seconds: 3000 + k }
    };
  });

  let an = 0;
  const act = (i, type, dateKey) => {
    const pid = ids[i];
    mem.actions["demo_a" + (an++)] = {
      playerId: pid, nick: mem.players[pid].nick, type,
      points: PONTOS[type], dateKey, createdAt: { seconds: 4000 + an }
    };
  };
  const dA = "2026-06-03", dB = hojeKey();
  act(0, "win", dA); act(0, "goal", dA); act(0, "goal", dA); act(0, "assist", dA);
  act(1, "win", dA); act(1, "goal", dA); act(1, "assist", dA);
  act(2, "goal", dA); act(2, "gaia", dA); act(2, "yellow", dA);
  act(3, "win", dA); act(3, "assist", dA); act(4, "goal", dA);
  act(0, "goal", dB); act(0, "assist", dB);
  act(1, "win", dB); act(1, "goal", dB); act(1, "goal", dB);
  act(5, "win", dB); act(5, "goal", dB);
  act(2, "goal", dB); act(6, "gaia", dB); act(7, "yellow", dB);
}

/* Banner do MODO TESTE no topo */
function mostrarBannerDemo() {
  const b = document.createElement("div");
  b.className = "demo-banner";
  b.innerHTML = "🧪 <b>MODO TESTE</b> — dados de mentira, nada é salvo de verdade. " +
    "Senha de qualquer jogador de teste: <b>123</b> · " +
    "<a href='index.html'>↩ sair do teste</a>";
  document.body.prepend(b);
}

/* =====================================================================
   19) INÍCIO
   ===================================================================== */
function startListeners() {
  dbWatch("players", (arr) => {
    state.players = arr;
    if (state.meId && !state.players.some(p => p.id === state.meId)) setMe(null);
    renderTudo();
  });
  dbWatch("votes", (arr) => { state.votes = arr; renderVotacao(); });
  dbWatch("listEntries", (arr) => { state.listEntries = arr; renderLista(); });
  dbWatch("actions", (arr) => { state.actions = arr; renderScores(); });
}

if (DEMO) { mostrarBannerDemo(); seedDemo(); startListeners(); }
else if (!semChaves) { startListeners(); }

/* Atualiza o status "quadra aberta/fechada" a cada minuto */
setInterval(renderJanela, 60 * 1000);

/* Primeiro render */
renderTudo();
