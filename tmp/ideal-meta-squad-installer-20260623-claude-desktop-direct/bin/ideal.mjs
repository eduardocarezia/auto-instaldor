#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import tty from "node:tty";

const INSTALL_COMMANDS = ["init", "instalar"];
const METHOD_COMMANDS = ["idealizar", "desenhar", "executar", "aprimorar", "lancar"];
const METASQUAD_COMMANDS = ["diagnosticar", "desenhar", "criar", "criticar", "padronizar", "versionar"];
const METASQUAD_FULL_COMMANDS = METASQUAD_COMMANDS.map((command) => `metasquad:${command}`);
const MAINTENANCE_COMMANDS = ["diagnosticar", "ferramentas", "caminhos", "versao"];
const AUTH_COMMANDS = ["entrar", "login", "sair", "logout", "auth"];
const IDEAL_COMMANDS = ["init", ...METHOD_COMMANDS];
const MARKER_START = "<!-- ideal-ai-first:start -->";
const MARKER_END = "<!-- ideal-ai-first:end -->";
const DEFAULT_AUTH_URL = "https://hub.automatiza-ai.com";
const CLAUDE_DESKTOP_PLUGIN_ROOT_RE = /(?:^|[/\\])skills-plugin[/\\][^/\\]+[/\\][^/\\]+$/;

const args = process.argv.slice(2);
const explicitCommand = args.find((arg) => !arg.startsWith("-"));
const helpRequested = args.includes("--help") || args.includes("-h") || args.includes("--ajuda");
const command = normalizeCommand(explicitCommand || (helpRequested ? "--help" : "instalar"));
const options = parseOptions(args);
options.defaultWizard = !explicitCommand && !helpRequested;

if (command === "--help" || command === "help" || command === "ajuda") {
  printHelp();
  process.exit(0);
}

if (AUTH_COMMANDS.includes(command)) {
  await handleAuthCommand(command, options);
  process.exit(0);
}

if (INSTALL_COMMANDS.includes(command)) {
  await maybeRunInstallWizard(options);
  await ensureAuthenticatedForInstall(options);
  install(options);
  process.exit(0);
}

if (METHOD_COMMANDS.includes(command)) {
  printPhasePrompt(command, args.filter((arg) => !arg.startsWith("-")).slice(1).join(" "));
  process.exit(0);
}

if (METASQUAD_FULL_COMMANDS.includes(command)) {
  printMetaSquadPrompt(command.replace("metasquad:", ""), args.filter((arg) => !arg.startsWith("-")).slice(1).join(" "));
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
    .replace(/^metasquad:/, "metasquad:")
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
    "metasquad:diagnóstico": "metasquad:diagnosticar",
    "metasquad:diagnostico": "metasquad:diagnosticar",
    "metasquad:criar-squad": "metasquad:criar",
    "metasquad:criar-squads": "metasquad:criar",
  };

  return aliases[normalized] || normalized;
}

function parseOptions(argv) {
  const result = {
    cwd: process.cwd(),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    wizard: !argv.includes("--no-wizard") && !argv.includes("--sem-wizard"),
    claudeDesktopSync: !argv.includes("--no-claude-desktop-sync") && !argv.includes("--sem-sync-claude-desktop"),
    scope: "global",
    targets: ["codex", "claude", "claude-desktop"],
    authUrl: process.env.IDEAL_AUTH_URL || DEFAULT_AUTH_URL,
    scopeProvided: false,
    targetsProvided: false,
    authUrlProvided: Boolean(process.env.IDEAL_AUTH_URL),
    productSlug: "",
  };

  const targetArg = argv.find((arg) => arg.startsWith("--targets="));
  if (targetArg) {
    result.targetsProvided = true;
    result.targets = targetArg
      .replace("--targets=", "")
      .split(",")
      .map((target) => normalizeTarget(target.trim()))
      .filter(Boolean);
  }

  const targetsIndex = argv.indexOf("--targets");
  if (targetsIndex >= 0 && argv[targetsIndex + 1]) {
    result.targetsProvided = true;
    result.targets = argv[targetsIndex + 1]
      .split(",")
      .map((target) => normalizeTarget(target.trim()))
      .filter(Boolean);
  }

  const cwdIndex = argv.indexOf("--cwd");
  if (cwdIndex >= 0 && argv[cwdIndex + 1]) {
    result.cwd = path.resolve(argv[cwdIndex + 1]);
  }

  const scopeArg = argv.find((arg) => arg.startsWith("--scope=") || arg.startsWith("--escopo="));
  if (scopeArg) {
    result.scopeProvided = true;
    result.scope = scopeArg.replace("--scope=", "");
    result.scope = result.scope.replace("--escopo=", "");
  }

  const scopeIndex = argv.indexOf("--scope");
  if (scopeIndex >= 0 && argv[scopeIndex + 1]) {
    result.scopeProvided = true;
    result.scope = argv[scopeIndex + 1];
  }

  const escopoIndex = argv.indexOf("--escopo");
  if (escopoIndex >= 0 && argv[escopoIndex + 1]) {
    result.scopeProvided = true;
    result.scope = argv[escopoIndex + 1];
  }

  result.scope = normalizeScope(result.scope);

  const authUrlArg = argv.find((arg) => arg.startsWith("--auth-url="));
  if (authUrlArg) {
    result.authUrlProvided = true;
    result.authUrl = authUrlArg.replace("--auth-url=", "");
  }

  const authUrlIndex = argv.indexOf("--auth-url");
  if (authUrlIndex >= 0 && argv[authUrlIndex + 1]) {
    result.authUrlProvided = true;
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
  npx ideal-ai-first@latest
  npx ideal-ai-first@latest ideal:instalar [--escopo projeto|global|ambos] [--targets codex,claude,claude-desktop,cursor]
  npx ideal-ai-first@latest ideal:entrar
  npx ideal-ai-first@latest ideal:diagnosticar
  npx ideal-ai-first@latest ideal:idealizar "o que voce quer criar"
  npx ideal-ai-first@latest ideal:desenhar "processo, agente ou projeto"
  npx ideal-ai-first@latest ideal:executar "teste controlado"
  npx ideal-ai-first@latest ideal:aprimorar "melhoria aprovada"
  npx ideal-ai-first@latest ideal:lancar "versao validada"
  npx ideal-ai-first@latest metasquad:criar "squad comercial"
  npx ideal-ai-first@latest metasquad:diagnosticar "rotina atual"

Targets:
  codex           AGENTS.md, .codex/prompts e hooks
  claude          Claude Code: CLAUDE.md, .claude/commands/ideal e .claude/skills
  claude-desktop  Claude Desktop/Web: skills locais e pacotes ZIP importaveis pela interface
  cursor          .cursor/rules e .cursor/commands/ideal

Escopos:
  projeto instala no projeto atual
  global  instala em ~/.codex, ~/.claude e gera pacote Cursor em ~/.cursor/ideal
  ambos   instala nos dois

Flags uteis:
  --no-claude-desktop-sync  gera ZIPs, mas nao altera o armazenamento local do Claude Desktop
  IDEAL_CLAUDE_DESKTOP_SKILLS_DIR  aponta manualmente para a pasta skills ou plugin root do Claude Desktop

Autenticacao:
  sem argumentos, a CLI abre um wizard de instalacao guiada
  area de membros padrao: ${DEFAULT_AUTH_URL}
  ideal:instalar com --auth-url faz login automaticamente se ainda nao houver token local
  ideal:entrar autentica na area de membros via fluxo OAuth-like por codigo
  ideal:sair remove o token local
  --auth-url tambem pode ser definido por IDEAL_AUTH_URL
`);
}

async function maybeRunInstallWizard(options) {
  const shouldOpenWizard =
    options.wizard &&
    !options.yes &&
    (options.defaultWizard || !options.scopeProvided || !options.targetsProvided);

  if (!shouldOpenWizard) return;

  const terminal = createTerminal();
  if (!terminal) {
    fail("Wizard indisponivel neste terminal. Rode com --yes ou informe --escopo e --targets.");
  }

  try {
    console.log("Assistente de instalacao IDEAL Meta-Squad");
    console.log("Use setas para navegar, espaco para selecionar e Enter para continuar.");
    console.log("");

    if (!options.targetsProvided) {
      options.targets = await selectMultiple(terminal, {
        title: "Ferramentas para instalar",
        choices: [
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude Code" },
          { value: "claude-desktop", label: "Claude Desktop/Web" },
          { value: "cursor", label: "Cursor" },
        ],
        selectedValues: options.targets,
      });
    }

    if (!options.scopeProvided) {
      options.scope = await selectOne(terminal, {
        title: "Escopo da instalacao",
        choices: [
          { value: "global", label: "Global - instala uma vez para usar em todos os projetos" },
          { value: "project", label: "Projeto - instala apenas na pasta atual" },
          { value: "both", label: "Ambos - global e projeto atual" },
        ],
        selectedValue: options.scope,
      });
    }

    console.log("");
    console.log("Resumo:");
    console.log(`  Ferramentas: ${options.targets.join(", ")}`);
    console.log(`  Escopo: ${formatScope(options.scope)}`);
    console.log("");

    await waitForInstallConfirmation(terminal);
    console.log("");
  } finally {
    terminal.close();
  }
}

function createTerminal() {
  if (process.stdin.isTTY) {
    return prepareTerminal(process.stdin, process.stdout, () => {});
  }

  if (process.platform !== "win32" && fs.existsSync("/dev/tty")) {
    const fd = fs.openSync("/dev/tty", "r");
    const input = new tty.ReadStream(fd);
    return prepareTerminal(input, process.stdout, () => input.destroy());
  }

  return null;
}

function prepareTerminal(input, output, cleanup) {
  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  input.resume();
  output.write("\x1b[?25l");

  return {
    input,
    output,
    close() {
      output.write("\x1b[?25h");
      if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
      cleanup();
    },
  };
}

async function selectMultiple(terminal, { title, choices, selectedValues }) {
  let cursor = 0;
  let selected = new Set(selectedValues);
  let renderedLines = 0;
  let message = "";

  for (;;) {
    renderedLines = renderMenu(
      terminal.output,
      [
        `${title}`,
        "Espaco marca/desmarca. Enter confirma.",
        "",
        ...choices.map((choice, index) => {
          const pointer = index === cursor ? ">" : " ";
          const checked = selected.has(choice.value) ? "[x]" : "[ ]";
          return `${pointer} ${checked} ${choice.label}`;
        }),
        message ? "" : null,
        message || null,
      ].filter(Boolean),
      renderedLines,
    );

    const { key } = await readKey(terminal.input);
    if (isCancelKey(key)) cancelWizard();
    if (key.name === "up") cursor = (cursor - 1 + choices.length) % choices.length;
    if (key.name === "down") cursor = (cursor + 1) % choices.length;
    if (key.name === "space") {
      const value = choices[cursor].value;
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      message = "";
    }
    if (isEnterKey(key)) {
      if (selected.size) {
        terminal.output.write("\n");
        return choices.filter((choice) => selected.has(choice.value)).map((choice) => choice.value);
      }
      message = "Selecione pelo menos uma ferramenta.";
    }
  }
}

async function selectOne(terminal, { title, choices, selectedValue }) {
  let cursor = Math.max(0, choices.findIndex((choice) => choice.value === selectedValue));
  let selected = choices[cursor].value;
  let renderedLines = 0;

  for (;;) {
    renderedLines = renderMenu(
      terminal.output,
      [
        `${title}`,
        "Espaco seleciona. Enter confirma.",
        "",
        ...choices.map((choice, index) => {
          const pointer = index === cursor ? ">" : " ";
          const checked = selected === choice.value ? "(x)" : "( )";
          return `${pointer} ${checked} ${choice.label}`;
        }),
      ],
      renderedLines,
    );

    const { key } = await readKey(terminal.input);
    if (isCancelKey(key)) cancelWizard();
    if (key.name === "up") cursor = (cursor - 1 + choices.length) % choices.length;
    if (key.name === "down") cursor = (cursor + 1) % choices.length;
    if (key.name === "space") selected = choices[cursor].value;
    if (isEnterKey(key)) {
      selected = choices[cursor].value;
      terminal.output.write("\n");
      return selected;
    }
  }
}

async function waitForInstallConfirmation(terminal) {
  let renderedLines = 0;
  renderedLines = renderMenu(
    terminal.output,
    ["Pressione Enter para instalar.", "Pressione Esc para cancelar."],
    renderedLines,
  );

  for (;;) {
    const { key } = await readKey(terminal.input);
    if (isCancelKey(key)) cancelWizard();
    if (isEnterKey(key)) {
      terminal.output.write("\n");
      return;
    }
  }
}

function renderMenu(output, lines, previousLineCount) {
  if (previousLineCount) output.write(`\x1b[${previousLineCount}F`);
  const total = Math.max(previousLineCount, lines.length);
  for (let index = 0; index < total; index += 1) {
    output.write("\x1b[2K\r");
    if (index < lines.length) output.write(lines[index]);
    output.write("\n");
  }
  return lines.length;
}

function readKey(input) {
  return new Promise((resolve) => {
    input.once("keypress", (str, key = {}) => resolve({ str, key }));
  });
}

function isEnterKey(key) {
  return key.name === "return" || key.name === "enter";
}

function isCancelKey(key) {
  return key.ctrl && key.name === "c" || key.name === "escape";
}

function cancelWizard() {
  console.log("");
  fail("Instalacao cancelada pelo usuario.");
}

function formatScope(scope) {
  const labels = {
    project: "projeto",
    global: "global",
    both: "ambos",
  };
  return labels[scope] || scope;
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
  writeFile(options, "META-SQUAD.md", metaSquadDocument());
  installIdealStructure(options);

  if (options.targets.includes("codex")) installCodex(options);
  if (options.targets.includes("claude")) installClaude(options);
  if (options.targets.includes("claude-desktop")) installClaudeDesktop(options);
  if (options.targets.includes("cursor")) installCursor(options);
}

function installGlobal(options) {
  const homeOptions = { ...options, cwd: os.homedir() };
  writeFile(homeOptions, ".ideal/IDEAL.md", idealDocument());
  writeFile(homeOptions, ".ideal/META-SQUAD.md", metaSquadDocument());
  installIdealStructure(homeOptions);

  if (options.targets.includes("codex")) installCodexGlobal(homeOptions);
  if (options.targets.includes("claude")) installClaudeGlobal(homeOptions);
  if (options.targets.includes("claude-desktop")) installClaudeDesktopGlobal(homeOptions);
  if (options.targets.includes("cursor")) installCursorGlobal(homeOptions);
}

function installCodex(options) {
  appendManagedBlock(options, "AGENTS.md", codexAgentsBlock());
  installCodexArtifacts(options);
}

function installCodexGlobal(options) {
  appendManagedBlock(options, ".codex/AGENTS.md", codexAgentsBlock());
  installCodexArtifacts(options);
}

function installCodexArtifacts(options) {
  for (const phase of IDEAL_COMMANDS) {
    writeFile(options, `.codex/prompts/ideal-${phase}.md`, commandPrompt(phase));
    writeFile(options, `.codex/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Codex"));
  }

  for (const command of METASQUAD_COMMANDS) {
    writeFile(options, `.codex/prompts/metasquad-${command}.md`, metaSquadPrompt(command));
    writeFile(options, `.codex/skills/metasquad-${command}/SKILL.md`, metaSquadSkillDocument(command, "Codex"));
  }

  mergeCodexHooks(options, ".codex/hooks.json");
  writeCodexProcessHooks(options);
  writeFile(options, ".codex/state/.gitkeep", "");
}

function installClaude(options) {
  appendManagedBlock(options, "CLAUDE.md", claudeBlock());

  for (const phase of IDEAL_COMMANDS) {
    writeFile(options, `.claude/commands/ideal/${phase}.md`, claudeCommand(phase));
    writeFile(options, `.claude/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Claude Code"));
  }

  for (const command of METASQUAD_COMMANDS) {
    writeFile(options, `.claude/commands/metasquad/${command}.md`, metaSquadClaudeCommand(command));
    writeFile(options, `.claude/skills/metasquad-${command}/SKILL.md`, metaSquadSkillDocument(command, "Claude Code"));
  }
}

function installClaudeGlobal(options) {
  appendManagedBlock(options, ".claude/CLAUDE.md", claudeBlock());

  for (const phase of IDEAL_COMMANDS) {
    writeFile(options, `.claude/commands/ideal/${phase}.md`, claudeCommand(phase));
    writeFile(options, `.claude/skills/ideal-${phase}/SKILL.md`, skillDocument(phase, "Claude Code"));
  }

  for (const command of METASQUAD_COMMANDS) {
    writeFile(options, `.claude/commands/metasquad/${command}.md`, metaSquadClaudeCommand(command));
    writeFile(options, `.claude/skills/metasquad-${command}/SKILL.md`, metaSquadSkillDocument(command, "Claude Code"));
  }
}

function installClaudeDesktop(options) {
  writeClaudeDesktopPackages(options, ".claude/desktop-skills");
}

function installClaudeDesktopGlobal(options) {
  const directInstalled = installClaudeDesktopLocalSkills(options);
  writeClaudeDesktopPackages(options, ".claude/desktop-skills", { manualHint: !directInstalled });
}

function writeClaudeDesktopPackages(options, root, packageOptions = {}) {
  writeFile(options, `${root}/README.md`, claudeDesktopReadme(root));

  for (const artifact of claudeDesktopSkillArtifacts()) {
    removeLegacyClaudeDesktopSkillFile(options, `${root}/${artifact.name}/skill.md`);
    writeFile(options, `${root}/${artifact.name}/SKILL.md`, artifact.content);
  }

  zipClaudeDesktopSkills(options, root, packageOptions);
}

function removeLegacyClaudeDesktopSkillFile(options, relativePath) {
  const fullPath = path.join(options.cwd, relativePath);
  const directory = path.dirname(fullPath);
  const fileName = path.basename(fullPath);
  if (options.dryRun || !fs.existsSync(directory)) return;
  if (!fs.readdirSync(directory).includes(fileName)) return;
  fs.rmSync(fullPath, { force: true });
  log(options, "remove", relativePath);
}

function installCursor(options) {
  writeFile(options, ".cursor/rules/ideal.mdc", cursorRule());

  for (const phase of IDEAL_COMMANDS) {
    writeFile(options, `.cursor/commands/ideal/${phase}.md`, commandPrompt(phase));
  }

  for (const command of METASQUAD_COMMANDS) {
    writeFile(options, `.cursor/commands/metasquad/${command}.md`, metaSquadPrompt(command));
  }
}

function installCursorGlobal(options) {
  writeFile(options, ".cursor/ideal/README.md", cursorGlobalReadme());
  writeFile(options, ".cursor/ideal/rules/ideal.mdc", cursorRule());

  for (const phase of IDEAL_COMMANDS) {
    writeFile(options, `.cursor/ideal/commands/ideal/${phase}.md`, commandPrompt(phase));
  }

  for (const command of METASQUAD_COMMANDS) {
    writeFile(options, `.cursor/ideal/commands/metasquad/${command}.md`, metaSquadPrompt(command));
  }
}

function installIdealStructure(options) {
  const files = [
    ".ideal/memoria/usuario.md",
    ".ideal/memoria/projeto.md",
    ".ideal/memoria/decisoes.md",
    ".ideal/memoria/aprendizados.md",
    ".ideal/memoria/rotinas.md",
    ".ideal/memoria/squads.md",
    ".ideal/modulos/metodo-ideal/README.md",
    ".ideal/modulos/metasquad/README.md",
    ".ideal/modulos/empresa/README.md",
  ];

  for (const file of files) {
    writeFile(options, file, idealSupportFile(file));
  }
}

function ensureKnownTargets(targets) {
  const known = new Set(["codex", "claude", "claude-desktop", "cursor"]);
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

function normalizeTarget(target) {
  const aliases = {
    "claude-code": "claude",
    claude_code: "claude",
    claudecode: "claude",
    "claude-desktop": "claude-desktop",
    claude_desktop: "claude-desktop",
    "claude-web": "claude-desktop",
    claude_web: "claude-desktop",
    desktop: "claude-desktop",
    web: "claude-desktop",
  };
  return aliases[target] || target;
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
      console.log("Nao autenticado. Rode ideal:entrar.");
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
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (!options.force && existing === content) {
    log(options, "skip", relativePath);
    return;
  }
  if (!options.force && existing && !isManagedFile(existing) && !isManagedGeneratedPath(relativePath)) {
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

function zipClaudeDesktopSkills(options, root, packageOptions = {}) {
  const skills = [
    ...IDEAL_COMMANDS.map((phase) => `ideal-${phase}`),
    ...METASQUAD_COMMANDS.map((command) => `metasquad-${command}`),
  ];

  for (const skill of skills) {
    const zipRelativePath = `${root}/${skill}.zip`;
    if (options.dryRun) {
      log(options, "write", zipRelativePath);
      continue;
    }

    const packageRoot = path.join(options.cwd, root);
    const zipPath = path.join(packageRoot, `${skill}.zip`);
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

    const result = spawnSync("zip", ["-qr", `${skill}.zip`, skill], {
      cwd: packageRoot,
      stdio: "ignore",
    });

    if (result.error && result.error.code === "ENOENT") {
      log(options, "manual", `zip nao encontrado; compacte manualmente as pastas em ${root}`);
      return;
    }

    if (result.status !== 0) {
      log(options, "manual", `nao foi possivel compactar ${zipRelativePath}; compacte manualmente a pasta ${root}/${skill}`);
      continue;
    }

    log(options, "write", zipRelativePath);
  }

  if (!options.dryRun && packageOptions.manualHint !== false) {
    log(options, "manual", `Claude Desktop/Web: importe os ZIPs em ${path.join(options.cwd, root)}`);
  }
}

function installClaudeDesktopLocalSkills(options) {
  if (!options.claudeDesktopSync) {
    log(options, "skip", "instalacao direta no Claude Desktop desativada");
    return false;
  }

  const pluginRoots = findClaudeDesktopSkillsPluginRoots();
  if (!pluginRoots.length) {
    log(options, "manual", "Claude Desktop local nao encontrado; use os ZIPs em ~/.claude/desktop-skills");
    return false;
  }

  const artifacts = claudeDesktopSkillArtifacts();
  for (const pluginRoot of pluginRoots) {
    const pluginOptions = { ...options, cwd: pluginRoot };
    for (const artifact of artifacts) {
      writeFile(pluginOptions, `skills/${artifact.name}/SKILL.md`, artifact.content);
    }
    updateClaudeDesktopManifest(options, pluginRoot, artifacts);
    log(options, "install", `Claude Desktop direto: ${path.join(pluginRoot, "skills")}`);
  }

  if (!options.dryRun) {
    log(options, "manual", "reinicie o Claude Desktop para recarregar as skills instaladas direto na pasta local");
  }

  return true;
}

function updateClaudeDesktopManifest(options, pluginRoot, artifacts) {
  const manifestPath = path.join(pluginRoot, "manifest.json");
  const manifest = readJsonFile(manifestPath) || { lastUpdated: Date.now(), skills: [] };
  if (!Array.isArray(manifest.skills)) manifest.skills = [];

  const byName = new Map(manifest.skills.map((skill) => [skill.name, skill]));
  const additions = [];
  let changed = false;

  for (const artifact of artifacts) {
    const existing = byName.get(artifact.name);
    if (existing) {
      if (existing.skillId !== artifact.name) {
        existing.skillId = artifact.name;
        changed = true;
      }
      if (existing.creatorType !== "user") {
        existing.creatorType = "user";
        changed = true;
      }
      if (existing.syncManaged !== false) {
        existing.syncManaged = false;
        changed = true;
      }
      if (existing.enabled !== true) {
        existing.enabled = true;
        changed = true;
      }
      if (existing.description !== artifact.description) {
        existing.description = artifact.description;
        existing.updatedAt = new Date().toISOString();
        changed = true;
      }
      continue;
    }

    additions.push({
      skillId: artifact.name,
      name: artifact.name,
      description: artifact.description,
      creatorType: "user",
      syncManaged: false,
      updatedAt: new Date().toISOString(),
      enabled: true,
    });
  }

  if (additions.length) {
    const idealInitIndex = manifest.skills.findIndex((skill) => skill.name === "ideal-init");
    const insertAt = idealInitIndex >= 0 ? idealInitIndex + 1 : 0;
    manifest.skills.splice(insertAt, 0, ...additions);
    changed = true;
  }

  if (!changed) {
    log(options, "skip", "Claude Desktop manifest.json");
    return;
  }

  manifest.lastUpdated = Date.now();
  if (options.dryRun) {
    log(options, "write", "Claude Desktop manifest.json");
    return;
  }

  const backupPath = `${manifestPath}.ideal-backup`;
  if (fs.existsSync(manifestPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(manifestPath, backupPath);
    log(options, "write", "Claude Desktop manifest backup");
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  log(options, "write", "Claude Desktop manifest.json");
}

function findClaudeDesktopSkillsPluginRoots() {
  const explicitRoot = process.env.IDEAL_CLAUDE_DESKTOP_SKILLS_DIR || process.env.CLAUDE_DESKTOP_SKILLS_DIR;
  if (explicitRoot) {
    const root = normalizeClaudeDesktopSkillsRoot(explicitRoot);
    if (root) return [root];
  }

  const roots = [];
  for (const base of getClaudeDesktopSkillsPluginBases()) {
    if (!base || !fs.existsSync(base)) continue;
    roots.push(...findClaudeDesktopPluginRoots(base, 5));
  }

  return [...new Set(roots)];
}

function getClaudeDesktopSkillsPluginBases() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions", "skills-plugin"),
    ];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(appData, "Claude", "local-agent-mode-sessions", "skills-plugin"),
      path.join(localAppData, "Claude", "local-agent-mode-sessions", "skills-plugin"),
    ];
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    path.join(configHome, "Claude", "local-agent-mode-sessions", "skills-plugin"),
    path.join(home, ".config", "Claude", "local-agent-mode-sessions", "skills-plugin"),
  ];
}

function listDirectories(root) {
  try {
    return fs
      .readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((entry) => fs.statSync(entry).isDirectory());
  } catch {
    return [];
  }
}

function findClaudeDesktopPluginRoots(root, maxDepth) {
  const found = [];

  function visit(current, depth) {
    const manifestPath = path.join(current, "manifest.json");
    const skillsPath = path.join(current, "skills");
    if (isClaudeDesktopPluginRoot(current) && fs.existsSync(manifestPath) && fs.existsSync(skillsPath)) {
      found.push(current);
      return;
    }

    if (depth >= maxDepth) return;
    for (const child of listDirectories(current)) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);
  return found;
}

function isClaudeDesktopPluginRoot(candidatePath) {
  return CLAUDE_DESKTOP_PLUGIN_ROOT_RE.test(candidatePath);
}

function normalizeClaudeDesktopSkillsRoot(candidatePath) {
  const expanded = path.resolve(candidatePath.replace(/^~(?=$|[/\\])/, os.homedir()));
  const root = path.basename(expanded) === "skills" ? path.dirname(expanded) : expanded;
  const manifestPath = path.join(root, "manifest.json");
  const skillsPath = path.join(root, "skills");
  if (!isClaudeDesktopPluginRoot(root) || !fs.existsSync(manifestPath) || !fs.existsSync(skillsPath)) {
    fail(`Pasta do Claude Desktop invalida: ${candidatePath}`);
  }
  return root;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
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
  removeHooksByCommandIncludes(data.hooks, ["ideal_process_prompt.py", "ideal_process_stop.py"]);
  addHook(data.hooks, "UserPromptSubmit", {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/process_improvement_prompt.py"))}`,
        timeout: 10,
        statusMessage: "Verificando se a demanda afeta rotina/processo",
      },
    ],
  });
  addHook(data.hooks, "PostToolUse", {
    matcher: "^apply_patch$",
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/process_improvement_post_tool.py"))}`,
        timeout: 10,
        statusMessage: "Checando documentacao de melhoria de processo",
      },
    ],
  });
  addHook(data.hooks, "Stop", {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/process_improvement_stop.py"))}`,
        timeout: 10,
        statusMessage: "Checando pendencias de documentacao de processo",
      },
    ],
  });
  addHook(data.hooks, "PreCompact", {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 ${JSON.stringify(path.join(options.cwd, ".codex/hooks/process_improvement_pre_compact.py"))}`,
        timeout: 10,
        statusMessage: "Preservando decisoes de melhoria de processo",
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

function removeHooksByCommandIncludes(hooks, fragments) {
  for (const eventName of Object.keys(hooks)) {
    if (!Array.isArray(hooks[eventName])) continue;
    hooks[eventName] = hooks[eventName]
      .map((entry) => {
        if (!Array.isArray(entry.hooks)) return entry;
        const nextHooks = entry.hooks.filter((hook) => {
          const command = String(hook.command || "");
          return !fragments.some((fragment) => command.includes(fragment));
        });
        return { ...entry, hooks: nextHooks };
      })
      .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.length);
  }
}

function writeCodexProcessHooks(options) {
  writeFile(options, ".codex/hooks/process_improvement_common.py", codexHookCommonPy());
  writeFile(options, ".codex/hooks/process_improvement_prompt.py", codexHookPromptPy());
  writeFile(options, ".codex/hooks/process_improvement_post_tool.py", codexHookPostToolPy());
  writeFile(options, ".codex/hooks/process_improvement_stop.py", codexHookStopPy());
  writeFile(options, ".codex/hooks/process_improvement_pre_compact.py", codexHookPreCompactPy());
}

function isManagedFile(content) {
  return content.includes("Generated by ideal-ai-first") || content.includes(MARKER_START);
}

function isManagedGeneratedPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return [
    /^\.codex\/prompts\/(ideal|metasquad)-[^/]+\.md$/,
    /^\.codex\/skills\/(ideal|metasquad)-[^/]+\/SKILL\.md$/,
    /^\.codex\/hooks\/process_improvement_[^/]+\.py$/,
    /^\.claude\/commands\/(ideal|metasquad)\/[^/]+\.md$/,
    /^\.claude\/skills\/(ideal|metasquad)-[^/]+\/SKILL\.md$/,
    /^\.claude\/desktop-skills\/README\.md$/,
    /^\.claude\/desktop-skills\/(ideal|metasquad)-[^/]+\/skill\.md$/,
    /^\.claude\/desktop-skills\/(ideal|metasquad)-[^/]+\/SKILL\.md$/,
    /^\.claude\/desktop-skills\/(ideal|metasquad)-[^/]+\.zip$/,
    /^skills\/(ideal|metasquad)-[^/]+\/SKILL\.md$/,
    /^\.cursor\/commands\/(ideal|metasquad)\/[^/]+\.md$/,
    /^\.cursor\/ideal\/commands\/(ideal|metasquad)\/[^/]+\.md$/,
    /^\.ideal\/(memoria|modulos)\//,
  ].some((pattern) => pattern.test(normalized));
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

function printMetaSquadPrompt(command, subject) {
  console.log(metaSquadPrompt(command, subject || "<descreva o squad, rotina ou area>"));
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

function metaSquadDocument() {
  return `# Meta Squad AI-first

> Generated by ideal-ai-first. Fonte local para criar, diagnosticar e evoluir squads de IA.

## Regra central

Meta Squad e o framework para transformar uma rotina empresarial em um conjunto coordenado de agentes, skills, comandos, hooks, memoria e criterios de validacao.

Use o prefixo \`metasquad\` quando o objetivo for criar ou melhorar squads, agentes, handoffs, rotinas agenticas ou workflows de IA. Use \`ideal\` quando o objetivo for governanca, processo, documentacao, teste e lancamento.

## Ciclo Meta Squad

1. Diagnosticar: entender objetivo, area, rotina atual, gargalos, entradas, saidas, riscos e medida de sucesso.
2. Desenhar: definir arquitetura do squad, papeis, agentes, skills, comandos, ferramentas, memoria, handoffs e criterios.
3. Criar: gerar o pacote operacional do squad com estrutura de pastas, instrucoes, prompts, templates, checklists e plano de teste.
4. Criticar: revisar falhas, conflitos, lacunas, seguranca, excesso de autonomia e ausencia de evidencias.
5. Padronizar: converter aprendizados em rotina reutilizavel, skill, prompt, hook ou checklist.
6. Versionar: registrar versao, mudancas, rollback, owners, evidencias e proximos experimentos.

## Estrutura minima de um squad

- Objetivo de negocio.
- Dono humano.
- Entradas permitidas.
- Saidas esperadas.
- Agentes e responsabilidades.
- Skills/comandos instalados.
- Memoria operacional usada.
- Ferramentas e permissoes.
- Handoffs e limites.
- Criterios de aceite.
- Plano de teste e rollback.

## Criterio de pronto

Um squad esta pronto quando outro agente consegue executar a rotina, auditar decisoes, localizar memoria/fonte de verdade, medir resultado e propor uma melhoria sem depender do historico da conversa.
`;
}

function idealSupportFile(relativePath) {
  const title = relativePath
    .split("/")
    .slice(-2)
    .join("/")
    .replace(".md", "");

  return `# ${title}

> Generated by ideal-ai-first.

Use este arquivo como memoria operacional curta. Ele deve apontar para a fonte de verdade correta; nao substitui \`IDEAL.md\`, \`META-SQUAD.md\` ou documentos de processo.
`;
}

function codexAgentsBlock() {
  return `## Metodo IDEAL AI-first

- Antes de criar processo, agente, projeto, rotina ou documento, consultar \`IDEAL.md\`.
- Antes de criar ou melhorar squads de IA, consultar \`META-SQUAD.md\`.
- Usar as etapas \`ideal:init\`, \`ideal:idealizar\`, \`ideal:desenhar\`, \`ideal:executar\`, \`ideal:aprimorar\` e \`ideal:lancar\`.
- Usar \`metasquad:diagnosticar\`, \`metasquad:desenhar\`, \`metasquad:criar\`, \`metasquad:criticar\`, \`metasquad:padronizar\` e \`metasquad:versionar\` para squads, agentes e workflows.
- Se o usuario aprovar correcao, melhoria ou ajuste de rotina/processo, documentar na fonte de verdade correspondente.
- Referencias a outros documentos devem aparecer ao longo do texto, no ponto exato em que o contexto e usado.
- Memoria operacional nao substitui documentacao; ela aponta para a fonte correta.`;
}

function claudeBlock() {
  return `# Metodo IDEAL AI-first

Consulte \`IDEAL.md\` antes de criar processos, agentes, projetos, rotinas ou documentos.
Consulte \`META-SQUAD.md\` antes de criar ou melhorar squads, agentes, handoffs e workflows de IA.

Use os comandos:
- \`/ideal:init\`
- \`/ideal:idealizar\`
- \`/ideal:desenhar\`
- \`/ideal:executar\`
- \`/ideal:aprimorar\`
- \`/ideal:lancar\`
- \`/metasquad:diagnosticar\`
- \`/metasquad:desenhar\`
- \`/metasquad:criar\`
- \`/metasquad:criticar\`
- \`/metasquad:padronizar\`
- \`/metasquad:versionar\`

Toda melhoria aprovada de rotina/processo deve ser documentada na fonte de verdade e, se reutilizavel, registrada como memoria operacional.`;
}

function cursorRule() {
  return `---
description: Metodo IDEAL AI-first para criar processos, agentes, projetos e rotinas.
alwaysApply: false
---

Consulte \`IDEAL.md\` quando o pedido envolver criacao ou melhoria de processo, agente, projeto, rotina ou documentacao.
Consulte \`META-SQUAD.md\` quando o pedido envolver criacao, diagnostico, critica ou evolucao de squads de IA.

Siga as etapas IDEAL:
1. Idealizar
2. Desenhar
3. Executar
4. Aprimorar
5. Lancar

Ao documentar, use chamadas dinamicas a outros documentos no ponto exato em que o contexto e necessario. Nao concentre referencias apenas no topo ou no rodape.

Para squads, use o ciclo Meta Squad: diagnosticar, desenhar, criar, criticar, padronizar e versionar.
`;
}

function cursorGlobalReadme() {
  return `# IDEAL para Cursor

O Cursor possui regras globais via Settings/User Rules. Este pacote gera os artefatos abaixo para revisao e copia:

- \`rules/ideal.mdc\`: regra IDEAL.
- \`commands/ideal/*.md\`: comandos IDEAL.
- \`commands/metasquad/*.md\`: comandos Meta Squad.

Para uso por projeto, rode:

\`\`\`sh
npx ideal-ai-first@latest ideal:init --scope project --targets cursor
\`\`\`

Para uso global, copie o conteudo de \`rules/ideal.mdc\` para Cursor Settings > Rules > User Rules e importe os comandos conforme o fluxo de commands/deeplinks do Cursor.
`;
}

function claudeDesktopReadme(root) {
  return `# IDEAL para Claude Desktop/Web

> Generated by ideal-ai-first.

Claude Desktop/Web usa importacao de skills pela interface do Claude. Ele nao carrega automaticamente as skills de \`~/.claude/skills\`, que sao usadas pelo Claude Code.

## Como importar

1. Abra Claude Desktop ou Claude Web.
2. Acesse Customize > Skills.
3. Clique em + ou Create skill.
4. Envie os arquivos ZIP gerados nesta pasta.
5. Ative as skills importadas.

## Pacotes gerados

Cada pasta \`${root}/ideal-*\` e \`${root}/metasquad-*\` contem uma skill. Quando o comando \`zip\` esta disponivel no sistema, o instalador tambem gera um ZIP por skill para upload direto.

Depois da importacao, use as skills IDEAL para processos e as skills Meta Squad para criar squads, agentes, comandos, workflows e rotinas com IA.
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

function metaSquadClaudeCommand(command) {
  return `---
description: Meta Squad - ${command}
argument-hint: [contexto]
---

${metaSquadPrompt(command, "$ARGUMENTS")}
`;
}

function claudeDesktopSkillArtifacts() {
  return [
    ...IDEAL_COMMANDS.map((phase) => ({
      name: `ideal-${phase}`,
      description: idealSkillDescription(phase, "Claude Desktop/Web"),
      content: skillDocument(phase, "Claude Desktop/Web"),
    })),
    ...METASQUAD_COMMANDS.map((command) => ({
      name: `metasquad-${command}`,
      description: metaSquadSkillDescription(command, "Claude Desktop/Web"),
      content: metaSquadSkillDocument(command, "Claude Desktop/Web"),
    })),
  ];
}

function idealSkillDescription(phase, toolName) {
  const descriptions = {
    init: "Use quando o usuario pedir ideal:init ou quando precisar inicializar o Metodo IDEAL em um projeto.",
    idealizar: "Use quando o usuario pedir ideal:idealizar ou quando precisar definir problema, usuario, escopo e criterio de sucesso.",
    desenhar: "Use quando o usuario pedir ideal:desenhar ou quando precisar transformar uma ideia em arquitetura operacional.",
    executar: "Use quando o usuario pedir ideal:executar ou quando precisar construir ou rodar um teste controlado.",
    aprimorar: "Use quando o usuario pedir ideal:aprimorar ou quando precisar medir resultado, registrar aprendizado e atualizar processo.",
    lancar: "Use quando o usuario pedir ideal:lancar ou quando precisar publicar, entregar ou escalar uma versao validada.",
  };

  return descriptions[phase] || `Use esta skill no ${toolName} para aplicar o Metodo IDEAL.`;
}

function metaSquadSkillDescription(command, toolName) {
  const descriptions = {
    diagnosticar: "Use quando o usuario pedir metasquad:diagnosticar ou quando precisar avaliar uma rotina antes de criar um squad de IA.",
    desenhar: "Use quando o usuario pedir metasquad:desenhar ou quando precisar desenhar a arquitetura de um squad de IA.",
    criar: "Use quando o usuario pedir metasquad:criar ou quando precisar criar um squad de IA com agentes, skills, comandos, memoria e testes.",
    criticar: "Use quando o usuario pedir metasquad:criticar ou quando precisar revisar riscos, lacunas e conflitos de um squad.",
    padronizar: "Use quando o usuario pedir metasquad:padronizar ou quando precisar transformar aprendizados do squad em rotina, skill ou checklist reutilizavel.",
    versionar: "Use quando o usuario pedir metasquad:versionar ou quando precisar registrar versao, mudancas, evidencias e rollback de um squad.",
  };

  return descriptions[command] || `Use esta skill no ${toolName} para aplicar o framework Meta Squad.`;
}

function skillDocument(phase, toolName) {
  return `---
name: ideal-${phase}
description: ${JSON.stringify(idealSkillDescription(phase, toolName))}
---

# ideal:${phase}

> Generated by ideal-ai-first.

Use esta skill no ${toolName} quando o usuario pedir \`ideal:${phase}\` ou quando a tarefa encaixar nesta etapa do Metodo IDEAL.

${commandPrompt(phase, "Contexto fornecido pelo usuario.")}

## Saida esperada

- Decisoes tomadas.
- Fonte de verdade consultada ou proposta.
- Evidencias ou criterios de aceite.
- Pendencias e proxima etapa IDEAL.
`;
}

function metaSquadSkillDocument(command, toolName) {
  return `---
name: metasquad-${command}
description: ${JSON.stringify(metaSquadSkillDescription(command, toolName))}
---

# metasquad:${command}

> Generated by ideal-ai-first.

Use esta skill no ${toolName} quando o usuario pedir \`metasquad:${command}\` ou quando a tarefa envolver criacao, diagnostico, critica ou evolucao de squads de IA.

${metaSquadPrompt(command, "Contexto fornecido pelo usuario.")}

## Saida esperada

- Objetivo do squad ou rotina.
- Agentes, papeis e handoffs.
- Skills, comandos, hooks e memorias necessarias.
- Criterios de aceite, evidencias e riscos.
- Proxima etapa Meta Squad.
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

> Generated by ideal-ai-first.

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

function metaSquadPrompt(command, subject = "$ARGUMENTS") {
  const titles = {
    diagnosticar: "Diagnosticar Squad",
    desenhar: "Desenhar Squad",
    criar: "Criar Squad",
    criticar: "Criticar Squad",
    padronizar: "Padronizar Squad",
    versionar: "Versionar Squad",
  };

  const bodies = {
    diagnosticar:
      "Mapeie objetivo de negocio, area, rotina atual, entradas, saidas, gargalos, riscos, frequencia, dono humano, ferramentas, dados sensiveis, criterio de sucesso e se um squad e realmente necessario.",
    desenhar:
      "Desenhe arquitetura operacional: agentes, responsabilidades, skills, comandos, hooks, memoria, handoffs, limites de autonomia, fontes de verdade, plano de teste, evidencias e rollback.",
    criar:
      "Crie o pacote do squad: manifesto, agentes, skills, comandos, workflows, templates, checklist de execucao, memoria inicial, criterios de aceite, testes controlados e instrucoes de instalacao nas ferramentas escolhidas.",
    criticar:
      "Revise o squad de forma adversarial: lacunas, agentes redundantes, conflitos de papel, falta de evidencia, risco de autonomia, ausencia de fonte de verdade, falhas de handoff e pontos sem rollback.",
    padronizar:
      "Transforme erros recorrentes e aprendizados em rotina reutilizavel: regra operacional, skill, prompt, hook, template, checklist, memoria ou atualizacao de fonte de verdade.",
    versionar:
      "Registre versao do squad: mudancas, motivo, impacto esperado, evidencias, riscos residuais, plano de rollback, owners, dependencias e proximo experimento.",
  };

  return `# metasquad:${command} - ${titles[command]}

> Generated by ideal-ai-first.

Contexto do usuario:
${subject}

Consulte \`META-SQUAD.md\` e mantenha o Metodo IDEAL em \`IDEAL.md\` como governanca de processo.

Objetivo desta etapa:
${bodies[command]}

Regras obrigatorias:
- Use \`metasquad\` para squads, agentes, handoffs, skills e workflows.
- Use \`ideal\` para governanca, documentacao, testes, melhorias e lancamento.
- Nao crie agente sem objetivo, entrada, saida, limite, memoria e criterio de aceite.
- Se o squad alterar rotina/processo existente, consulte a fonte de verdade antes de mudar.
- Se houver melhoria aprovada, atualize a documentacao fonte e registre memoria operacional quando reutilizavel.
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
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/process_improvement_prompt.py"))}`,
                timeout: 10,
                statusMessage: "Verificando se a demanda afeta rotina/processo",
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "^apply_patch$",
            hooks: [
              {
                type: "command",
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/process_improvement_post_tool.py"))}`,
                timeout: 10,
                statusMessage: "Checando documentacao de melhoria de processo",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/process_improvement_stop.py"))}`,
                timeout: 10,
                statusMessage: "Checando pendencias de documentacao de processo",
              },
            ],
          },
        ],
        PreCompact: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/python3 ${JSON.stringify(path.join(root, ".codex/hooks/process_improvement_pre_compact.py"))}`,
                timeout: 10,
                statusMessage: "Preservando decisoes de melhoria de processo",
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

function codexHookCommonPy() {
  return `#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / ".codex" / "state"
STATE_PATH = STATE_DIR / "process-improvement-pending.json"
DOC_SYSTEM_PATH = ROOT / "IDEAL.md"
META_SQUAD_PATH = ROOT / "META-SQUAD.md"
AGENTS_PATH = ROOT / "AGENTS.md"
MEMORY_NOTE_DIR = Path.home() / ".codex" / "memories" / "extensions" / "ad_hoc" / "notes"


PROCESS_RE = re.compile(
    r"\\b(rotina|processo|procedimento|auto[ -]?aprimoramento|self[ -]?improvement|"
    r"mem[oó]ria operacional|fonte de verdade|documenta[cç][aã]o|hook|hooks|agents\\.md|"
    r"agente|agentes|squad|squads|meta[ -]?squad|metasquad|workflow|workflows)\\b",
    re.IGNORECASE,
)

APPROVAL_RE = re.compile(
    r"\\b(aprovad[oa]|aprovo|pode salvar|salva isso|salve isso|documenta isso|"
    r"registre isso|registra isso|vira regra|virar regra|vira processo|virar processo|"
    r"implementa isso|pode implementar|perfeito)\\b",
    re.IGNORECASE,
)


def read_payload():
    try:
        return json.loads(__import__("sys").stdin.read() or "{}")
    except json.JSONDecodeError:
        return {}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_state():
    if not STATE_PATH.exists():
        return {"pending": []}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"pending": []}
    if not isinstance(data, dict) or not isinstance(data.get("pending"), list):
        return {"pending": []}
    return data


def save_state(data):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")


def pending_for_session(data, session_id):
    return [
        item
        for item in data.get("pending", [])
        if item.get("session_id") == session_id and not item.get("resolved_at")
    ]


def has_relevant_doc_patch(text):
    targets = [
        "IDEAL.md",
        "META-SQUAD.md",
        "AGENTS.md",
        "CLAUDE.md",
        "Processos",
        "Rotinas",
        ".ideal/memoria",
        ".ideal/modulos",
        ".codex/hooks",
        ".codex/hooks.json",
        "memories/extensions/ad_hoc/notes",
    ]
    return any(target in text for target in targets)


def resolve_session(data, session_id, reason):
    changed = False
    for item in data.get("pending", []):
        if item.get("session_id") == session_id and not item.get("resolved_at"):
            item["resolved_at"] = now_iso()
            item["resolution_reason"] = reason
            changed = True
    if changed:
        save_state(data)
    return changed


def emit_context(message):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": message,
                }
            },
            ensure_ascii=False,
        )
    )


def emit_stop(reason):
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
`;
}

function codexHookPromptPy() {
  return `#!/usr/bin/env python3
from process_improvement_common import (
    AGENTS_PATH,
    APPROVAL_RE,
    DOC_SYSTEM_PATH,
    META_SQUAD_PATH,
    PROCESS_RE,
    emit_context,
    load_state,
    now_iso,
    pending_for_session,
    read_payload,
    save_state,
)


payload = read_payload()
prompt = payload.get("prompt") or ""
session_id = payload.get("session_id") or "unknown-session"
turn_id = payload.get("turn_id") or "unknown-turn"

looks_like_process = bool(PROCESS_RE.search(prompt))
looks_approved = bool(APPROVAL_RE.search(prompt))

state = load_state()
existing_pending = pending_for_session(state, session_id)
approval_for_existing_process = looks_approved and bool(existing_pending)

if not looks_like_process and not approval_for_existing_process:
    raise SystemExit(0)

if looks_like_process:
    state.setdefault("pending", []).append(
        {
            "session_id": session_id,
            "turn_id": turn_id,
            "created_at": now_iso(),
            "approved_signal": looks_approved,
            "process_signal": True,
            "prompt_excerpt": prompt[:500],
        }
    )
elif approval_for_existing_process:
    existing_pending[-1]["approved_signal"] = True
    existing_pending[-1]["approved_at"] = now_iso()
    existing_pending[-1]["approval_excerpt"] = prompt[:500]

save_state(state)

if looks_approved or approval_for_existing_process:
    emit_context(
        "Esta mensagem parece aprovar ou pedir implementacao de uma melhoria ligada a rotina, processo, agente ou squad. "
        f"Antes de finalizar, consulte {DOC_SYSTEM_PATH}, {META_SQUAD_PATH} e {AGENTS_PATH}. "
        "Se a decisao afetar uma rotina existente, atualize a fonte de verdade correspondente; se for regra reutilizavel, crie uma nota em "
        "~/.codex/memories/extensions/ad_hoc/notes/. "
        "Ao documentar, referencie outros documentos no ponto exato em que o contexto for necessario, como chamadas dinamicas ao longo do texto."
    )
else:
    emit_context(
        "Esta mensagem parece tocar rotina, processo, documentacao, agente ou squad. Verifique se ja existe rotina relacionada e, se houver mudanca permanente, "
        "peca aprovacao antes de transformar em autoaprimoramento documentado. Use IDEAL.md e META-SQUAD.md como fontes locais do metodo."
    )
`;
}

function codexHookPostToolPy() {
  return `#!/usr/bin/env python3
from process_improvement_common import (
    has_relevant_doc_patch,
    load_state,
    read_payload,
    resolve_session,
)


payload = read_payload()
session_id = payload.get("session_id") or "unknown-session"
tool_input = payload.get("tool_input") or {}
tool_response = payload.get("tool_response") or {}

combined = f"{tool_input}\\n{tool_response}"

if has_relevant_doc_patch(combined):
    resolve_session(load_state(), session_id, "relevant documentation, hook, ideal memory or meta squad file edited")
`;
}

function codexHookStopPy() {
  return `#!/usr/bin/env python3
from process_improvement_common import (
    DOC_SYSTEM_PATH,
    META_SQUAD_PATH,
    emit_stop,
    load_state,
    pending_for_session,
    read_payload,
)


payload = read_payload()
session_id = payload.get("session_id") or "unknown-session"

if payload.get("stop_hook_active"):
    raise SystemExit(0)

pending = pending_for_session(load_state(), session_id)
approved_pending = [item for item in pending if item.get("approved_signal")]

if not approved_pending:
    raise SystemExit(0)

latest = approved_pending[-1]
excerpt = latest.get("prompt_excerpt", "")

emit_stop(
    "Antes de finalizar, existe uma melhoria de rotina/processo/squad aparentemente aprovada nesta conversa e ainda nao marcada como documentada. "
    f"Consulte {DOC_SYSTEM_PATH} e {META_SQUAD_PATH}, atualize a fonte de verdade correta e, se a regra for reutilizavel, crie uma nota em "
    "~/.codex/memories/extensions/ad_hoc/notes/. "
    "Depois valide que a documentacao usa chamadas dinamicas a outros documentos ao longo do texto, nao apenas referencias no topo ou rodape. "
    f"Trecho gatilho: {excerpt[:240]}"
)
`;
}

function codexHookPreCompactPy() {
  return `#!/usr/bin/env python3
from process_improvement_common import (
    load_state,
    pending_for_session,
    read_payload,
)
import json


payload = read_payload()
session_id = payload.get("session_id") or "unknown-session"
pending = pending_for_session(load_state(), session_id)

if pending:
    print(
        json.dumps(
            {
                "systemMessage": "Ha decisoes de autoaprimoramento de rotina/processo/squad pendentes de documentacao antes da compactacao. Preserve no resumo as melhorias aprovadas que ainda precisam ser documentadas."
            },
            ensure_ascii=False,
        )
    )
`;
}
