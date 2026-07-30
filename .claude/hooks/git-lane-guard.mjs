#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const OVERRIDE = process.env.MNEIA_GIT_GUARD === "off";

const BRANCH_RE = /^(feat|fix|docs|chore|refactor|spike|test)\/mne-\d+(-[a-z0-9]+)+$/;
const TICKET_RE = /MNE-\d+/;

const DOCS_LANE = [
  /^[^/]+\.md$/,
  /^docs\//,
  /^\.github\/.*\.md$/,
  /^\.claude\//,
  /^(LICENSE|NOTICE|\.gitignore|\.gitattributes|\.editorconfig)$/,
];

const CODE_LANE_OVERRIDES = [
  /^\.claude\/settings(\.local)?\.json$/,
  /^\.claude\/hooks\//,
];

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function isDocsLane(file) {
  if (CODE_LANE_OVERRIDES.some((re) => re.test(file))) return false;
  return DOCS_LANE.some((re) => re.test(file));
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function pass() {
  process.exit(0);
}

const raw = readFileSync(0, "utf8");
let cmd = "";
try {
  cmd = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  pass();
}

if (OVERRIDE) pass();
if (!/\bgit\b/.test(cmd)) pass();

const isCommit = /\bgit\s+(-C\s+\S+\s+)?commit\b/.test(cmd);
const isPush = /\bgit\s+(-C\s+\S+\s+)?push\b/.test(cmd);
if (!isCommit && !isPush) pass();

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (!branch) pass();
const onMain = branch === "main" || branch === "master";

function commitMessage() {
  const f = cmd.match(/-F\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (f) {
    const path = f[1] || f[2] || f[3];
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return cmd;
}

function classify(files) {
  const code = files.filter((f) => f && !isDocsLane(f));
  return { code, docsOnly: code.length === 0 };
}

if (isCommit) {
  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  if (staged.length === 0) pass();

  const { code, docsOnly } = classify(staged);

  if (onMain && !docsOnly) {
    deny(
      `BLOCKED: code-lane files cannot be committed straight to ${branch}.\n\n` +
        `Code-lane files staged:\n${code.map((f) => `  - ${f}`).join("\n")}\n\n` +
        `Two-lane policy (CLAUDE.md > Git lanes):\n` +
        `  docs lane -> commit direct to main. *.md, docs/**, .claude/** (except settings.json and hooks/)\n` +
        `  code lane -> branch + PR. Everything else.\n\n` +
        `Fix: git switch -c <type>/mne-<n>-<slug>   e.g. feat/mne-42-context-item-schema\n` +
        `Types: feat fix docs chore refactor spike test\n\n` +
        `If this really belongs on main, re-run with MNEIA_GIT_GUARD=off prefixed and say why in the commit body.`,
    );
  }

  if (!TICKET_RE.test(commitMessage())) {
    deny(
      `BLOCKED: commit message has no MNE-nnn reference.\n\n` +
        `Linear links commits by ticket id, and AGENTS.md says work not in a ticket did not happen.\n` +
        `Subject format: MNE-<n>: <imperative summary>\n` +
        `Several tickets: MNE-42, MNE-43: <summary>\n\n` +
        `No ticket yet? Create one first (linear-ticket skill), then commit.`,
    );
  }

  if (!onMain && !BRANCH_RE.test(branch)) {
    deny(
      `BLOCKED: branch "${branch}" does not match the naming convention.\n\n` +
        `Required: <type>/mne-<n>-<slug>\n` +
        `Types:    feat fix docs chore refactor spike test\n` +
        `Example:  feat/mne-42-context-item-schema\n\n` +
        `The mne-<n> segment is what makes Linear auto-link the branch and PR.\n` +
        `Rename: git branch -m <type>/mne-<n>-<slug>`,
    );
  }

  pass();
}

if (isPush) {
  const target = cmd.match(/push\s+(?:-\S+\s+)*origin\s+(\S+)/);
  const pushingMain = /\borigin\s+(main|master)\b/.test(cmd) || (!target && onMain);
  if (!pushingMain) pass();

  git(["fetch", "origin", "--quiet"]);
  const base = git(["rev-parse", "--verify", "--quiet", "origin/main"]) ? "origin/main" : "";
  if (!base) pass();

  const files = git(["diff", "--name-only", `${base}..HEAD`]).split("\n").filter(Boolean);
  if (files.length === 0) pass();

  const { code, docsOnly } = classify(files);
  if (!docsOnly) {
    deny(
      `BLOCKED: this push to main carries code-lane changes.\n\n` +
        `Code-lane files in ${base}..HEAD:\n${code.map((f) => `  - ${f}`).join("\n")}\n\n` +
        `Code reaches main through a reviewed PR, not a direct push (CLAUDE.md > Git lanes).\n` +
        `Fix: move these commits onto <type>/mne-<n>-<slug>, push that, and open a PR.\n\n` +
        `Override with MNEIA_GIT_GUARD=off only if the founder asked for it explicitly.`,
    );
  }
  pass();
}

pass();
