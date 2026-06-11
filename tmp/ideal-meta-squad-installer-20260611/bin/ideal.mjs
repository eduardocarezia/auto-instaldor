#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const INSTALL_COMMANDS = ["init", "instalar"];
const METHOD_COMMANDS = ["idealizar", "desenhar", "executar", "aprimorar", "lancar"];
const MAINTENANCE_COMMANDS = ["diagnosticar", "ferramentas", "caminhos", "versao"];
const AUTH_COMMANDS = ["entrar", "login", "sair", "logout", "auth"];
const COMMANDS = ["init", ...METHOD_COMMANDS];
const MARKER_START = "<!-- ideal-ai-first:start -->";
const MARKER_END = "<!-- ideal-ai-first:end -->";

const args = process.argv.slice(2);
const command = normalizeCommand(args.find((arg) => !arg.startsWith("-")) || "--help");
const options = parseOptions(args);

if (command === "--help" || command === "help" || command === "ajuda") {
  printHelp();
  process.exit(0);
}

if (AUTH_COMMANDS.includes(command)) {
  await handleAuthCommand(command, options);
  process.exit(0);
}

if (INSTALL_COMMANDS.includes(command)) {
  await ensureAuthenticatedForInstall(options);
  install(options);
  process.exit(0);
}

if (METHOD_COMMANDS.includes(command)) {
  printPhasePrompt(command, args.filter((arg) => !arg.startsWith("-")).slice(1).join(" "));
  process.exit(0);
}

if (MAINTENANCE_COMMANDS.includes(command)) {
  printMaintenance(command, options);
  process.exit(0);
}

fail(`Comando desconhecido: ${command}`);

function normalizeCommand(value) {
  if (!value) return "--help";
  const normalized = value
    .replace(/^ideal:/, "")
    .replace("lançar", "lancar")
    .replace("--ajuda", "ajuda")
    .replace("--versao", "versao");

  const aliases = {
    iniciar: "init",
    instalar: "instalar",
    versao: "versao",
    version: "versao",
    doctor: "diagnosticar",
    autenticar: "entrar",
  };

  return aliases[normalized] || normalized;
}

function parseOptions(argv) {
  const result = {
    cwd: process.cwd(),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    scope: "project",
    targets: ["codex", "claude", "cursor"],
    authUrl: process.env.IDEAL_AUTH_URL || "",
    productSlug: "",
  };

  const targetArg = argv.find((arg) => arg.startsWith("--targets="));
  if (targetArg) {
    result.targets = targetArg
      .replace("--targets=", "")
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean);
  }

  const targetsIndex = argv.indexOf("--targets");
  if (targetsIndex >= 0 && argv[targetsIndex + 1]) {
    result.targets = argv[targetsIndex + 1]
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean);
  }

  const cwdIndex = argv.indexOf("--cwd");
  if (cwdIndex >= 0 && argv[cwdIndex + 1]) {
    result.cwd = path.resolve(argv[cwdIndex + 1]);
  }

  const scopeArg = argv.find((arg) => arg.startsWith("--scope=") || arg.startsWith("--escopo="));
  if (scopeArg) result.scope = scopeArg.replace("--scope=", "");
  if (scopeArg) result.scope = result.scope.replace("--escopo=", "");

  const scopeIndex = argv.indexOf("--scope");
  if (scopeIndex >= 0 && argv[scopeIndex + 1]) {
    result.scope = argv[scopeIndex + 1];
  }

  const escopoIndex = argv.indexOf("--escopo");
  if (escopoIndex >= 0 && argv[escopoIndex + 1]) {
    result.scope = argv[escopoIndex + 1];
  }

  result.scope = normalizeScope(result.scope);

  const authUrlArg = argv.find((arg) => arg.startsWith("--auth-url="));
  if (authUrlArg) result.authUrl = authUrlArg.replace("--auth-url=", "");

  const authUrlIndex = argv.indexOf("--auth-url");
  if (authUrlIndex >= 0 && argv[authUrlIndex + 1]) {
    result.authUrl = argv[authUrlIndex + 1];
  }

  const productArg = argv.find((arg) => arg.startsWith("--produto=") || arg.startsWith("--product="));
  if (productArg) {
    result.productSlug = productArg.replace("--produto=", "").replace("--product=", "");
  }

  const productIndex = argv.indexOf("--produto");
  if (productIndex >= 0 && argv[productIndex + 1]) {
    result.productSlug = argv[productIndex + 1];
  }

  const productEnIndex = argv.indexOf("--product");
  if (productEnIndex >= 0 && argv[productEnIndex + 1]) {
    result.productSlug = argv[productEnIndex + 1];
  }

  return result;
}

function printHelp() {
  console.log(`ideal-ai-first

Uso:
  npx ideal-ai-first@latest ideal:instalar [--escopo projeto|global|ambos] [--targets codex,claude,cursor] [--dry-run] [--force]
  npx ideal-ai-first@latest ideal:entrar --auth-url https://sua-area-de-membros.com
  npx ideal-ai-first@latest ideal:diagnosticar
  npx ideal-ai-first@latest ideal:idealizar "o que voce quer criar"
  npx ideal-ai-first@latest ideal:desenhar "processo, agente ou projeto"
  npx ideal-ai-first@latest ideal:executar "teste controlado"
  npx ideal-ai-first@latest ideal:aprimorar "melhoria aprovada"
  npx ideal-ai-first@latest ideal:lancar "versao validada"

Targets:
  codex   AGENTS.md, .codex/prompts e hooks
  claude  CLAUDE.md, .claude/commands/ideal e .claude/skills
  cursor  .cursor/rules e .cursor/commands/ideal

Escopos:
  projeto instala no projeto atual
  global  instala em ~/.codex, ~/.claude e gera pacote Cursor em ~/.cursor/ideal
  ambos   instala nos dois

Autenticacao:
  ideal:entrar autentica na area de membros via fluxo OAuth-like por codigo
  ideal:sair remove o token local
  --auth-url tambem pode ser definido por IDEAL_AUTH_URL
`);
}

function install(options) {
  ensureKnownTargets(options.targets);
  ensureKnownScope(options.scope);

  if (options.scope === "project" || options.scope === "both") {
    installProject(options);
  }

  if (options.scope === "global" || options.scope === "both") {
    installGlobal(options);
  }

  log(options, "ok", `Instalacao IDEAL concluida com escopo ${options.scope}`);
}

function installProject(options) {
  writeFile(options, "IDEAL.md", idealDocument());

  if (options.targets.includes("codex")) installCodex(options);
  if (options.targets.includes("claude")) installClaude(options);
  if (options.targets.includes("cursor")) installCursor(options);
}

function installGlobal(options) {
  const homeOptions = { ...options, cwd: os.homedir() };
  writeFile(homeOptions, ".ideal/IDEAL.md", idealDocument());

  if (options.targets.includes("codex")) installCodexGlobal(homeOptions);
  if (options.targets.includes("claude")) installClaudeGlobal(homeOptions);
  if (options.targets.includes("cursor")) installCursorGlobal(homeOptions);
}

function installCodex(options) {
  appendManagedBlock(options, "AGENTS.md", codexAgentsBlock());

  for (const phase of COMMANDS) {
    writeFile(options, `.codex/prompts/ideal-${phase}.md`, commandPrompt(phase));
    writeFile(options, `.codex/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Codex"));
  }

  mergeCodexHooks(options, ".codex/hooks.json");
  writeFile(options, ".codex/hooks/ideal_process_prompt.py", codexHookPromptPy());
  writeFile(options, ".codex/hooks/ideal_process_stop.py", codexHookStopPy());
  writeFile(options, ".codex/state/.gitkeep", "");
}

function installCodexGlobal(options) {
  appendManagedBlock(options, ".codex/AGENTS.md", codexAgentsBlock());

  for (const phase of COMMANDS) {
    writeFile(options, `.codex/prompts/ideal-${phase}.md`, commandPrompt(phase));
    writeFile(options, `.codex/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Codex"));
  }

  mergeCodexHooks(options, ".codex/hooks.json");
  writeFile(options, ".codex/hooks/ideal_process_prompt.py", codexHookPromptPy());
  writeFile(options, ".codex/hooks/ideal_process_stop.py", codexHookStopPy());
  writeFile(options, ".codex/state/.gitkeep", "");
}

function installClaude(options) {
  appendManagedBlock(options, "CLAUDE.md", claudeBlock());

  for (const phase of COMMANDS) {
    writeFile(options, `.claude/commands/ideal/${phase}.md`, claudeCommand(phase));
    writeFile(options, `.claude/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Claude Code"));
  }
}

function installClaudeGlobal(options) {
  appendManagedBlock(options, ".claude/CLAUDE.md", claudeBlock());

  for (const phase of COMMANDS) {
    writeFile(options, `.claude/commands/ideal/${phase}.md`, claudeCommand(phase));
    writeFile(options, `.claude/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Claude Code"));
  }
}

function installCursor(options) {
  writeFile(options, ".cursor/rules/ideal.mdc", cursorRule());

  for (const phase of COMMANDS) {
    writeFile(options, `.cursor/commands/ideal/${phase}.md`, commandPrompt(phase));
  }
}

function installCursorGlobal(options) {
  writeFile(options, ".cursor/ideal/README.md", cursorGlobalReadme());
  writeFile(options, ".cursor/ideal/rules/ideal.mdc", cursorRule());

  for (const phase of COMMANDS) {
    writeFile(options, `.cursor/ideal/commands/${phase}.md`, commandPrompt(phase));
  }
}

function ensureKnownTargets(targets) {
  const known = new Set(["codex", "claude", "cursor"]);
  const unknown = targets.filter((target) => !known.has(target));
  if (unknown.length) fail(`Targets desconhecidos: ${unknown.join(", ")}`);
}

function ensureKnownScope(scope) {
  if (!["project", "global", "both"].includes(scope)) {
    fail(`Escopo desconhecido: ${scope}`);
  }
}

function normalizeScope(scope) {
  const aliases = {
    projeto: "project",
    project: "project",
    global: "global",
    ambos: "both",
    both: "both",
  };
  return aliases[scope] || scope;
}

function printMaintenance(command, options) {
  const home = os.homedir();
  const targetStatus = options.targets.map((target) => `${target}: configuravel`).join("\n  ");

  if (command === "versao") {
    console.log("ideal-ai-first 0.1.0");
    return;
  }

  if (command === "ferramentas") {
    console.log(`Ferramentas suportadas no prototipo:\n  ${targetStatus}`);
    return;
  }

  if (command === "caminhos") {
    console.log(`Caminhos principais:\n  projeto: ${options.cwd}\n  global: ${home}\n  ideal: ${path.join(home, ".ideal")}`);
    return;
  }

  console.log(`Diagnostico IDEAL:
  OS: ${os.platform()} ${os.arch()}
  Node.js: ${process.version}
  Projeto: ${options.cwd}
  Escopo padrao: ${options.scope}
  Targets: ${options.targets.join(", ")}
  Status: prototipo pronto para dry-run e instalacao local`);
}

async function handleAuthCommand(command, options) {
  if (command === "sair" || command === "logout") {
    const authPath = getAuthPath();
    if (fs.existsSync(authPath)) fs.rmSync(authPath);
    console.log("Token IDEAL removido deste computador.");
    return;
  }

  if (command === "auth") {
    const auth = readAuth();
    if (!auth) {
      console.log("Nao autenticado. Rode ideal:entrar --auth-url <url-da-area-de-membros>.");
      return;
    }
    console.log(`Autenticado em ${auth.authUrl}`);
    console.log(`Token expira em ${new Date(auth.expiresAt).toLocaleString("pt-BR")}`);
    return;
  }

  await login(options);
}

async function login(options) {
  const authUrl = normalizeAuthUrl(options.authUrl);
  if (!authUrl) {
    fail("Informe --auth-url ou defina IDEAL_AUTH_URL apontando para sua area de membros.");
  }

  const response = await fetch(`${authUrl}/api/ideal/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: `IDEAL CLI em ${os.hostname()}`,
      productSlug: options.productSlug || undefined,
      scopes: ["ideal:download"],
    }),
  });

  if (!response.ok) {
    fail(`Nao foi possivel iniciar login IDEAL (${response.status}).`);
  }

  const device = await response.json();
  console.log("Login IDEAL Meta-Squad");
  console.log(`Codigo: ${device.user_code}`);
  console.log(`Abra: ${device.verification_uri_complete}`);
  console.log("");
  openUrl(device.verification_uri_complete);
  console.log("Aguardando autorizacao na area de membros...");

  const expiresAt = Date.now() + device.expires_in * 1000;
  const intervalMs = Math.max(2, device.interval || 5) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);
    const tokenResponse = await fetch(`${authUrl}/api/ideal/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: device.device_code }),
    });

    if (tokenResponse.status === 428) continue;

    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      fail(`Login IDEAL falhou: ${tokenBody.error || tokenResponse.status}`);
    }

    const auth = {
      authUrl,
      accessToken: tokenBody.access_token,
      tokenType: tokenBody.token_type || "Bearer",
      scope: tokenBody.scope || "ideal:download",
      expiresAt: Date.now() + tokenBody.expires_in * 1000,
      createdAt: Date.now(),
    };
    writeAuth(auth);
    console.log("Autenticado com sucesso. Downloads IDEAL liberados para este computador.");
    return;
  }

  fail("Tempo de login expirado. Rode ideal:entrar novamente.");
}

async function ensureAuthenticatedForInstall(options) {
  if (options.dryRun) return;

  let auth = readAuth();
  if (!auth) {
    if (!options.authUrl) {
      fail("Instalacao protegida. Rode com --auth-url <url-da-area-de-membros> ou autentique antes com ideal:entrar.");
    }
    await login(options);
    auth = readAuth();
  }

  if (!auth) {
    fail("Nao foi possivel salvar a autenticacao IDEAL neste computador.");
  }

  if (auth.expiresAt <= Date.now()) {
    if (!options.authUrl) {
      fail("Token IDEAL expirado. Rode ideal:entrar novamente.");
    }
    await login(options);
    auth = readAuth();
  }

  if (!auth) {
    fail("Nao foi possivel renovar a autenticacao IDEAL neste computador.");
  }

  const manifestResponse = await fetch(`${auth.authUrl}/api/ideal/manifest`, {
    headers: { Authorization: `${auth.tokenType} ${auth.accessToken}` },
  });

  if (!manifestResponse.ok) {
    fail(`Token IDEAL invalido ou sem acesso pago (${manifestResponse.status}). Rode ideal:entrar novamente.`);
  }

  const manifest = await manifestResponse.json();
  log(options, "auth", `acesso liberado para ${manifest.member?.email || "membro pago"}`);
}

function normalizeAuthUrl(authUrl) {
  return (authUrl || "").trim().replace(/\/$/, "");
}

function getAuthPath() {
  return path.join(os.homedir(), ".ideal", "auth.json");
}

function readAuth() {
  const authPath = getAuthPath();
  if (!fs.existsSync(authPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  const authPath = getAuthPath();
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
}

function openUrl(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFile(options, relativePath, content) {
  const filePath = path.join(options.cwd, relativePath);
  if (!options.force && fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    log(options, "skip", relativePath);
    return;
  }
  if (!options.force && fs.existsSync(filePath) && !isManagedFile(fs.readFileSync(filePath, "utf8"))) {
    log(options, "skip", `${relativePath} ja existe; use --force para sobrescrever`);
    return;
  }
  if (options.dryRun) {
    log(options, "write", relativePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  if (relativePath.endsWith(".py")) fs.chmodSync(filePath, 0o755);
  log(options, "write", relativePath);
}

function appendManagedBlock(options, relativePath, block) {
  const filePath = path.join(options.cwd, relativePath);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const managed = `${MARKER_START}\n${block.trim()}\n${MARKER_END}`;
  const next = existing.includes(MARKER_START)
    ? existing.replace(new RegExp(`${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}`), managed)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${managed}\n`;

  if (options.dryRun) {
    log(options, "write", relativePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf8");
  log(options, "write", relativePath);
}

function mergeCodexHooks(options, relativePath) {
  const filePath = path.join(options.cwd, relativePath);
  let data = { hooks: {} };

  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      if (!options.force) {
        log(options, "skip", `${relativePath} nao e JSON valido; use --force para recriar`);
        return;
      }
    }
  }

  data.hooks = data.hooks && typeof data.hooks === "object" ? data.hooks : {};
  addHook(data.hooks, "UserPromptSubmit", {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/ideal_process_prompt.py"))}`,
        timeout: 10,
        statusMessage: "Verificando Metodo IDEAL",
      },
    ],
  });
  addHook(data.hooks, "Stop", {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/ideal_process_stop.py"))}`,
        timeout: 10,
        statusMessage: "Checando pendencias IDEAL",
      },
    ],
  });

  const content = `${JSON.stringify(data, null, 2)}\n`;
  if (options.dryRun) {
    log(options, "write", relativePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  log(options, "write", relativePath);
}

function addHook(hooks, eventName, group) {
  hooks[eventName] = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const command = group.hooks[0].command;
  const exists = hooks[eventName].some((entry) =>
    Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command),
  );
  if (!exists) hooks[eventName].push(group);
}

function isManagedFile(content) {
  return content.includes("Generated by ideal-ai-first") || content.includes(MARKER_START);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function log(options, action, message) {
  const prefix = options.dryRun ? "[dry-run]" : "[ideal]";
  console.log(`${prefix} ${action}: ${message}`);
}

function fail(message) {
  console.error(`[ideal] erro: ${message}`);
  process.exit(1);
}

function printPhasePrompt(phase, subject) {
  console.log(commandPrompt(phase, subject || "<descreva o que sera criado>"));
}

function idealDocument() {
  return `# Metodo IDEAL AI-first

> Generated by ideal-ai-first. Fonte local do processo para agentes.

## Regra central

Todo processo, agente, produto, rotina ou projeto deve passar pelas etapas:

1. Idealizar: definir problema, objetivo, usuario, restricoes, criterios e fonte de verdade.
2. Desenhar: transformar a ideia em arquitetura operacional, entradas, saidas, papeis, dados, ferramentas, riscos e plano de teste.
3. Executar: construir ou rodar teste controlado sem lancar no escuro.
4. Aprimorar: medir resultado, registrar aprendizado, atualizar processo e memoria operacional.
5. Lancar: publicar, entregar ou escalar apenas depois de validacao e plano de rollback.

## Documentacao AI-first

- Identifique a fonte de verdade antes de escrever.
- Atualize a fonte de verdade antes de documentos derivados.
- Evite duplicar contexto longo.
- Referencie outros documentos no ponto exato em que o contexto e usado, como chamada dinamica ao longo do texto.
- Toda melhoria aprovada de rotina/processo deve ser documentada no processo correspondente.
- Se a melhoria for reutilizavel em conversas futuras, registre memoria operacional curta e vinculada a documentacao fonte.

## Criterio de pronto

Uma entrega IDEAL esta pronta quando outro agente consegue entender o objetivo, executar o proximo passo, auditar a decisao e saber onde atualizar o processo sem depender do historico da conversa.
`;
}

function codexAgentsBlock() {
  return `## Metodo IDEAL AI-first

- Antes de criar processo, agente, projeto, rotina ou documento, consultar \`IDEAL.md\`.
- Usar as etapas \`ideal:init\`, \`ideal:idealizar\`, \`ideal:desenhar\`, \`ideal:executar\`, \`ideal:aprimorar\` e \`ideal:lancar\`.
- Se o usuario aprovar correcao, melhoria ou ajuste de rotina/processo, documentar na fonte de verdade correspondente.
- Referencias a outros documentos devem aparecer ao longo do texto, no ponto exato em que o contexto e usado.
- Memoria operacional nao substitui documentacao; ela aponta para a fonte correta.`;
}

function claudeBlock() {
  return `# Metodo IDEAL AI-first

Consulte \`IDEAL.md\` antes de criar processos, agentes, projetos, rotinas ou documentos.

Use os comandos:
- \`/ideal:init\`
- \`/ideal:idealizar\`
- \`/ideal:desenhar\`
- \`/ideal:executar\`
- \`/ideal:aprimorar\`
- \`/ideal:lancar\`

Toda melhoria aprovada de rotina/processo deve ser documentada na fonte de verdade e, se reutilizavel, registrada como memoria operacional.`;
}

function cursorRule() {
  return `---
description: Metodo IDEAL AI-first para criar processos, agentes, projetos e rotinas.
alwaysApply: false
---

Consulte \`IDEAL.md\` quando o pedido envolver criacao ou melhoria de processo, agente, projeto, rotina ou documentacao.

Siga as etapas IDEAL:
1. Idealizar
2. Desenhar
3. Executar
4. Aprimorar
5. Lancar

Ao documentar, use chamadas dinamicas a outros documentos no ponto exato em que o contexto e necessario. Nao concentre referencias apenas no topo ou no rodape.
`;
}

function cursorGlobalReadme() {
  return `# IDEAL para Cursor

O Cursor possui regras globais via Settings/User Rules. Este pacote gera os artefatos abaixo para revisao e copia:

- \`rules/ideal.mdc\`: regra IDEAL.
- \`commands/*.md\`: comandos IDEAL.

Para uso por projeto, rode:

\`\`\`sh
npx ideal-ai-first@latest ideal:init --scope project --targets cursor
\`\`\`

Para uso global, copie o conteudo de \`rules/ideal.mdc\` para Cursor Settings > Rules > User Rules e importe os comandos conforme o fluxo de commands/deeplinks do Cursor.
`;
}

function claudeCommand(phase) {
  return `---
description: Metodo IDEAL - ${phase}
argument-hint: [contexto]
---

${commandPrompt(phase, "$ARGUMENTS")}
`;
}

function skillDocument(phase, toolName) {
  return `# ideal:${phase}

Use esta skill no ${toolName} quando o usuario pedir \`ideal:${phase}\` ou quando a tarefa encaixar nesta etapa do Metodo IDEAL.

${commandPrompt(phase, "Contexto fornecido pelo usuario.")}

## Saida esperada

- Decisoes tomadas.
- Fonte de verdade consultada ou proposta.
- Evidencias ou criterios de aceite.
- Pendencias e proxima etapa IDEAL.
`;
}

function commandPrompt(phase, subject = "$ARGUMENTS") {
  const titles = {
    init: "Inicializar o Metodo IDEAL",
    idealizar: "Idealizar",
    desenhar: "Desenhar",
    executar: "Executar",
    aprimorar: "Aprimorar",
    lancar: "Lancar",
  };

  const bodies = {
    init: "Instale ou revise o contrato IDEAL neste projeto. Identifique arquivos de instrucao da ferramenta atual, fonte de verdade documental e comandos disponiveis.",
    idealizar: "Defina problema real, usuario, objetivo, escopo, restricoes, riscos, fonte de verdade, criterio de sucesso e decisao pendente antes de propor solucao.",
    desenhar: "Transforme a ideia em arquitetura operacional: entradas, saidas, papeis, etapas, dados, ferramentas, criterios, excecoes, plano de teste e evidencias.",
    executar: "Construa ou rode um teste controlado. Use Add First Remove Last, preserve caminho de rollback, registre status e valide antes de declarar pronto.",
    aprimorar: "Compare resultado contra criterio. Identifique falhas, aprove ou proponha melhorias, atualize a fonte de verdade e registre memoria operacional reutilizavel.",
    lancar: "Prepare publicacao ou escala: checklist final, evidencias, riscos residuais, plano de rollback, comunicacao e documentos derivados atualizados.",
  };

  return `# ideal:${phase} - ${titles[phase]}

Contexto do usuario:
${subject}

Siga criteriosamente o Metodo IDEAL em \`IDEAL.md\`.

Objetivo desta etapa:
${bodies[phase]}

Regras obrigatorias:
- Identifique a fonte de verdade antes de escrever.
- Nao duplique contexto longo; referencie documentos no ponto exato em que o contexto e usado.
- Se houver melhoria aprovada de rotina/processo, atualize a documentacao fonte.
- Se a regra for reutilizavel em conversas futuras, registre memoria operacional curta vinculada a fonte.
- Termine com proximos passos objetivos e criterios de aceite.
`;
}

function codexHooksJson(root) {
  return `${JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/ideal_process_prompt.py"))}`,
                timeout: 10,
                statusMessage: "Verificando Metodo IDEAL",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/ideal_process_stop.py"))}`,
                timeout: 10,
                statusMessage: "Checando pendencias IDEAL",
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  )}\n`;
}

function codexHookPromptPy() {
  return `#!/usr/bin/env python3
import json
import re
import sys

payload = json.loads(sys.stdin.read() or "{}")
prompt = payload.get("prompt", "")

pattern = re.compile(r"\\b(processo|rotina|procedimento|agente|projeto|idealizar|desenhar|executar|aprimorar|lancar|lançar|auto[ -]?aprimoramento)\\b", re.I)

if pattern.search(prompt):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "Este pedido parece exigir Metodo IDEAL. Consulte IDEAL.md antes de agir. Se houver melhoria aprovada de rotina/processo, documente na fonte de verdade e use referencias dinamicas ao longo do texto."
        }
    }, ensure_ascii=False))
`;
}

function codexHookStopPy() {
  return `#!/usr/bin/env python3
import json
import sys

payload = json.loads(sys.stdin.read() or "{}")
if payload.get("stop_hook_active"):
    raise SystemExit(0)

# Hook leve: nao bloqueia por padrao. O contrato principal fica em IDEAL.md e AGENTS.md.
raise SystemExit(0)
`;
}
