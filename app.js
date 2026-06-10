/* =====================================================================
   REAL FUT — app.js
   HTML/CSS/JS puro + Firebase Firestore (dados compartilhados em tempo real).
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================================================================
   1) COLE AQUI SUAS CHAVES DO FIREBASE
   --------------------------------------------------------------------
   No console do Firebase (Configurações do projeto > Seus apps > Web),
   copie o objeto "firebaseConfig" e cole no lugar do exemplo abaixo.
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

/* Senhas do site (combinado com você) */
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

/* ---------------------------------------------------------------------
   Inicialização do Firebase (com aviso caso as chaves não estejam coladas)
   --------------------------------------------------------------------- */
let db = null;
const semChaves = firebaseConfig.apiKey === "COLE_AQUI";
if (semChaves) {
  document.getElementById("firebaseWarning").classList.remove("hidden");
} else {
  const appFb = initializeApp(firebaseConfig);
  db = getFirestore(appFb);
}

/* Coleções */
const colPlayers = () => collection(db, "players");
const colVotes   = () => collection(db, "votes");
const colList    = () => collection(db, "listEntries");
const colActions = () => collection(db, "actions");

/* ---------------------------------------------------------------------
   Estado local (espelho do que vem do Firestore)
   --------------------------------------------------------------------- */
const state = {
  players: [],     // {id, name, nick, photo, gk}
  votes: [],       // {id(=playerId), agree}
  listEntries: [], // {id(=playerId), nick, photo, cycleKey, joinedAt}
  actions: [],     // {id, playerId, nick, type, points, dateKey}
  meId: localStorage.getItem("realfut_me") || null
};

/* =====================================================================
   2) HORÁRIO DE BRASÍLIA (não confia no relógio cru do aparelho)
   ===================================================================== */
function brasiliaParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return m; // {year, month, day, hour, minute, weekday:"Wed"...}
}

/* Data (YYYY-MM-DD) da quarta-feira do ciclo atual.
   Antes/durante a quarta aponta para a quarta desta semana;
   depois da quarta, aponta para a próxima → a lista zera sozinha. */
function cicloAtual() {
  const p = brasiliaParts();
  const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12));
  const dow = base.getUTCDay();            // 0=Dom ... 3=Qua
  const add = (3 - dow + 7) % 7;           // dias até quarta (0 se hoje é quarta)
  base.setUTCDate(base.getUTCDate() + add);
  return base.toISOString().slice(0, 10);
}

/* Data de hoje em Brasília (YYYY-MM-DD) */
function hojeKey() {
  const p = brasiliaParts();
  return `${p.year}-${p.month}-${p.day}`;
}

/* A "quadra" está aberta? Quarta, das 19:50 às 23:00 */
function quadraAberta() {
  const p = brasiliaParts();
  const min = (+p.hour) * 60 + (+p.minute);
  return p.weekday === "Wed" && min >= (19 * 60 + 50) && min < (23 * 60);
}

/* Formata YYYY-MM-DD para DD/MM */
function ddmm(key) {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  return `${d}/${m}`;
}

/* =====================================================================
   3) HELPERS DE UI
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const fotoOuPadrao = (p) =>
  (p && p.photo) ? p.photo
  : "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#cdd5e0'/><text x='50%' y='56%' font-size='34' text-anchor='middle' fill='#fff' font-family='Arial'>⚽</text></svg>`
    );
const meuJogador = () => state.players.find(p => p.id === state.meId) || null;
const precisaLogin = (msg) => { alert(msg || "Entre com seu nome primeiro!"); };

/* =====================================================================
   4) NAVEGAÇÃO ENTRE AS PARTES
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
   5) RENDER DAS REGRAS (estáticas)
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
   6) CADASTRO DE JOGADOR
   ===================================================================== */
let fotoBase64 = ""; // foto comprimida do cadastro em andamento

$("#btnOpenRegister").addEventListener("click", () => openModal("registerModal"));
$("#regPhoto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fotoBase64 = await comprimirImagem(file);
  const prev = $("#regPreview");
  prev.src = fotoBase64; prev.classList.remove("hidden");
});

/* Redimensiona/comprime a foto no navegador e devolve base64 (~256px, jpeg q0.6) */
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
  if (semChaves) return alert("Configure o Firebase primeiro (veja o aviso no topo).");
  const pass = $("#regPass").value.trim();
  const name = $("#regName").value.trim();
  const nick = $("#regNick").value.trim();
  const gk   = $("#regGK").checked;
  const err  = $("#regError");
  err.textContent = "";

  if (pass !== SENHA_CADASTRO) return err.textContent = "Senha de cadastro incorreta.";
  if (!name || !nick) return err.textContent = "Preencha nome e apelido.";
  if (state.players.some(p => p.nick.toLowerCase() === nick.toLowerCase()))
    return err.textContent = "Esse apelido já existe.";

  const id = "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  await setDoc(doc(colPlayers(), id), {
    name, nick, gk, photo: fotoBase64 || "", createdAt: serverTimestamp()
  });

  // já loga automaticamente o recém-cadastrado
  setMe(id);
  fotoBase64 = "";
  $("#regPass").value = $("#regName").value = $("#regNick").value = "";
  $("#regGK").checked = false;
  $("#regPreview").classList.add("hidden");
  closeModals();
});

/* =====================================================================
   7) LOGIN / LOGOUT (sessão simples — escolher o próprio nome)
   ===================================================================== */
$("#btnOpenLogin").addEventListener("click", () => {
  const sel = $("#loginSelect");
  sel.innerHTML = state.players.length
    ? state.players.map(p => `<option value="${p.id}">${p.name} (${p.nick})</option>`).join("")
    : `<option value="">Ninguém cadastrado ainda</option>`;
  openModal("loginModal");
});
$("#btnDoLogin").addEventListener("click", () => {
  const id = $("#loginSelect").value;
  if (!id) return $("#loginError").textContent = "Cadastre-se primeiro.";
  setMe(id); closeModals();
});
$("#btnLogout").addEventListener("click", () => setMe(null));

function setMe(id) {
  state.meId = id;
  if (id) localStorage.setItem("realfut_me", id);
  else localStorage.removeItem("realfut_me");
  renderTudo();
}

/* =====================================================================
   8) VOTAÇÃO DAS REGRAS
   ===================================================================== */
$("#btnAgree").addEventListener("click", () => votar(true));
$("#btnDisagree").addEventListener("click", () => votar(false));

async function votar(agree) {
  if (semChaves) return alert("Configure o Firebase primeiro.");
  const me = meuJogador();
  if (!me) return precisaLogin("Entre com seu nome para votar.");
  // doc id = playerId garante 1 voto por pessoa (e permite trocar)
  await setDoc(doc(colVotes(), me.id), {
    playerId: me.id, agree, updatedAt: serverTimestamp()
  });
}

/* =====================================================================
   9) LISTA DA QUARTA
   ===================================================================== */
$("#joinCheckbox").addEventListener("change", async (e) => {
  if (semChaves) { e.target.checked = false; return alert("Configure o Firebase primeiro."); }
  const me = meuJogador();
  if (!me) { e.target.checked = false; return precisaLogin("Entre com seu nome para entrar na lista."); }

  const ciclo = cicloAtual();
  const atuais = state.listEntries.filter(l => l.cycleKey === ciclo);

  if (e.target.checked) {
    if (atuais.length >= LIMITE_LISTA && !atuais.some(l => l.id === me.id)) {
      e.target.checked = false;
      return alert("🔒 Lista cheia! Já tem 20 jogadores.");
    }
    await setDoc(doc(colList(), me.id), {
      playerId: me.id, nick: me.nick, photo: me.photo || "",
      cycleKey: ciclo, joinedAt: serverTimestamp()
    });
  } else {
    await deleteDoc(doc(colList(), me.id));
  }
});

/* Zerar lista (admin) */
$("#btnResetList").addEventListener("click", () => {
  pedirSenha("Zerar lista", SENHA_ADMIN, async () => {
    const ciclo = cicloAtual();
    const atuais = state.listEntries.filter(l => l.cycleKey === ciclo);
    await Promise.all(atuais.map(l => deleteDoc(doc(colList(), l.id))));
    alert("Lista zerada! ✅");
  });
});

/* =====================================================================
   10) SORTEIO DE TIMES
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
  // pega os jogadores da lista da quarta, cruzando com o cadastro (p/ saber goleiro)
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

  // nº de times = quantos times de 5 de linha dá para fechar (máx 4)
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
    // se sobrou goleiro fixo, fixa um no gol deste time
    const golFixo = goleirosFixos.length ? goleirosFixos.shift() : null;
    times.push({ nome: nomes[t], cor: cores[t], jogadores, golFixo });
  }

  // quem sobra (linha extra + goleiros fixos sem time) = revezamento no gol emprestado
  const sobras = [...linha.slice(idx), ...goleirosFixos];

  // monta HTML
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
   11) REGISTRAR AÇÕES (Scores) — só quartas 19:50–23h
   ===================================================================== */
document.querySelectorAll(".btn.act").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (semChaves) return alert("Configure o Firebase primeiro.");
    const me = meuJogador();
    if (!me) return precisaLogin("Entre com seu nome para lançar ações.");
    if (!quadraAberta()) {
      return mostrarFeedback("🔒 A quadra tá fechada! Volta quarta às 19:50.", true);
    }
    const type = btn.dataset.type;
    const id = "a_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await setDoc(doc(colActions(), id), {
      playerId: me.id, nick: me.nick, type,
      points: PONTOS[type], dateKey: hojeKey(), createdAt: serverTimestamp()
    });
    mostrarFeedback(`${ROTULO[type]} lançado! ${PONTOS[type] > 0 ? "+" : ""}${PONTOS[type]} pts 🎉`);
  });
});

function mostrarFeedback(msg, erro = false) {
  const el = $("#actionFeedback");
  el.textContent = msg;
  el.style.color = erro ? "var(--vermelho)" : "var(--verde-d)";
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

/* Botão "Atualizar dados" — força recálculo (os dados já vêm em tempo real,
   mas o botão dá aquele feedback de "atualizou") */
$("#btnRefresh").addEventListener("click", () => {
  renderScores();
  mostrarFeedback("Ranking atualizado! 🔄");
});

/* =====================================================================
   12) RANKING / SCORES
   ===================================================================== */
function acoesDaTemporada() {
  return state.actions.filter(a => a.dateKey >= TEMPORADA_INICIO && a.dateKey <= TEMPORADA_FIM);
}

function calcularRanking() {
  const pontos = {}; // playerId -> total
  for (const a of acoesDaTemporada()) {
    pontos[a.playerId] = (pontos[a.playerId] || 0) + a.points;
  }
  // inclui todos os cadastrados (mesmo com 0)
  return state.players
    .map(p => ({ ...p, pts: pontos[p.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);
}

function renderScores() {
  const rank = calcularRanking();

  /* Pódio (top 3 com pelo menos alguém) */
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

  /* Tabela completa */
  $("#rankBody").innerHTML = rank.map((p, i) => `
    <tr>
      <td>${i + 1}º</td>
      <td><div class="rank-player"><img src="${fotoOuPadrao(p)}" alt="">${p.nick}</div></td>
      <td>${p.pts}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">Sem jogadores ainda.</td></tr>`;

  renderResumos();
  renderStatusTemporada();
}

/* Resumo por quarta (agrupado por data) */
function renderResumos() {
  const porData = {};
  for (const a of acoesDaTemporada()) {
    (porData[a.dateKey] = porData[a.dateKey] || []).push(a);
  }
  const datas = Object.keys(porData).sort().reverse();
  const cont = $("#matchSummaries");
  if (!datas.length) {
    cont.innerHTML = `<p class="muted">Nenhuma quarta registrada ainda.</p>`;
    return;
  }
  cont.innerHTML = datas.map(d => {
    const acoes = porData[d];
    const tipos = {};
    for (const a of acoes) (tipos[a.type] = tipos[a.type] || []).push(a.nick);
    const linha = (tipo, emoji) => tipos[tipo]
      ? `<span class="tag">${emoji} ${ROTULO[tipo]}: ${tipos[tipo].join(", ")}</span>` : "";
    // destaque do dia: quem somou mais pontos nesta quarta
    const somaDia = {};
    for (const a of acoes) somaDia[a.nick] = (somaDia[a.nick] || 0) + a.points;
    const craque = Object.entries(somaDia).sort((x, y) => y[1] - x[1])[0];
    return `<div class="match">
      <h4>📅 Quarta ${ddmm(d)} ${craque ? `— Craque: <b>${craque[0]}</b> (${craque[1]} pts)` : ""}</h4>
      <div class="line">
        ${linha("goal","⚽")}${linha("assist","🅰️")}${linha("win","🏅")}
        ${linha("gaia","😂")}${linha("yellow","🟨")}
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
   13) CARD COMEMORATIVO (fim de temporada)
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
  const card = $("#championCard");
  const canvas = await html2canvas(card, { backgroundColor: null, scale: 2 });
  const link = document.createElement("a");
  link.download = "campeoes-real-fut.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

/* =====================================================================
   14) MODAIS (abrir/fechar + senha genérica)
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
  if ($("#passInput").value.trim() !== acaoSenha.senhaCerta) {
    return $("#passError").textContent = "Senha incorreta.";
  }
  const fn = acaoSenha.onOk; acaoSenha = null;
  closeModals(); fn();
});

/* =====================================================================
   15) RENDER GERAL (chamado quando dados ou login mudam)
   ===================================================================== */
function renderLogin() {
  const me = meuJogador();
  if (me) {
    $("#loggedOut").classList.add("hidden");
    $("#loggedIn").classList.remove("hidden");
    $("#meNick").textContent = me.nick;
    $("#meAvatar").src = fotoOuPadrao(me);
  } else {
    $("#loggedOut").classList.remove("hidden");
    $("#loggedIn").classList.add("hidden");
  }
}

function renderVotacao() {
  const simVotos = state.votes.filter(v => v.agree);
  const naoVotos = state.votes.filter(v => !v.agree);
  const sim = simVotos.length, nao = naoVotos.length;
  const total = sim + nao;
  $("#countAgree").textContent = sim;
  $("#countDisagree").textContent = nao;
  $("#barAgree").style.width = total ? `${(sim / total) * 100}%` : "50%";
  $("#barDisagree").style.width = total ? `${(nao / total) * 100}%` : "50%";

  // mostra a foto de cada votante (acumula o voto de cada um)
  const avatares = (votos) => votos.map(v => {
    const p = state.players.find(x => x.id === v.id);
    return `<img src="${fotoOuPadrao(p)}" title="${p ? p.nick : "?"}" alt="">`;
  }).join("");
  $("#avatarsAgree").innerHTML = avatares(simVotos);
  $("#avatarsDisagree").innerHTML = avatares(naoVotos);

  const me = meuJogador();
  const hint = $("#voteHint");
  if (!me) hint.textContent = "Entre com seu nome para votar.";
  else {
    const meu = state.votes.find(v => v.id === me.id);
    hint.textContent = meu
      ? `Seu voto: ${meu.agree ? "👍 Concordo" : "👎 Não concordo"} (pode trocar).`
      : "Você ainda não votou.";
  }
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
  const estouNaLista = me && atuais.some(l => l.id === me.id);
  $("#joinCheckbox").checked = !!estouNaLista;
  $("#joinCheckbox").disabled = !me;

  $("#wedList").innerHTML = atuais.map(l => {
    const p = state.players.find(x => x.id === l.id);
    const ehMe = me && l.id === me.id;
    return `<li>
      <img class="ava" src="${fotoOuPadrao(p)}" alt="">
      <span>${l.nick}</span>
      ${ehMe ? `<span class="me-flag">você</span>` : ""}
    </li>`;
  }).join("") || `<li style="background:none">Ninguém na lista ainda. Seja o primeiro! ⚽</li>`;
}

function renderJanela() {
  const aberta = quadraAberta();
  const banner = $("#windowBanner");
  banner.classList.toggle("open", aberta);
  banner.classList.toggle("closed", !aberta);
  $("#windowText").textContent = aberta
    ? "🟢 QUADRA ABERTA! Pode lançar suas ações até as 23h."
    : "🔴 Quadra fechada. Ações só nas quartas, das 19:50 às 23h (horário de Brasília).";

  const me = meuJogador();
  $("#actionWho").classList.toggle("hidden", !!me);
  $("#actionPanel").classList.toggle("hidden", !me);
  document.querySelectorAll(".btn.act").forEach(b => b.disabled = !aberta);
}

function renderTudo() {
  renderLogin();
  renderVotacao();
  renderLista();
  renderJanela();
  renderScores();
}

/* =====================================================================
   16) LISTENERS EM TEMPO REAL (Firestore → state → tela)
   ===================================================================== */
if (!semChaves) {
  onSnapshot(colPlayers(), (snap) => {
    state.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // se o jogador logado foi removido, desloga
    if (state.meId && !state.players.some(p => p.id === state.meId)) setMe(null);
    renderTudo();
  });
  onSnapshot(colVotes(), (snap) => {
    state.votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderVotacao();
  });
  onSnapshot(colList(), (snap) => {
    state.listEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLista();
  });
  onSnapshot(colActions(), (snap) => {
    state.actions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderScores();
  });
}

/* Atualiza o status de "quadra aberta/fechada" a cada minuto */
setInterval(renderJanela, 60 * 1000);

/* Primeiro render (mesmo sem chaves, mostra a interface) */
renderTudo();
