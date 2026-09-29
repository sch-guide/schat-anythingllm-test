#!/usr/bin/env node
const crypto = require("crypto");
const bcrypt = require("/app/server/node_modules/bcryptjs");
const prisma = require("/app/server/utils/prisma");
const { makeJWT } = require("/app/server/utils/http");

const WORKSPACE_SLUG = "schat-2026-09-22";

async function create() {
  const workspace = await prisma.workspaces.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { id: true },
  });
  if (!workspace) throw new Error("local_test_workspace_missing");

  const suffix = crypto.randomBytes(8).toString("hex");
  const username = `schat_eval_${suffix}`;
  const password = crypto.randomBytes(24).toString("base64url");
  const user = await prisma.users.create({
    data: {
      username,
      password: bcrypt.hashSync(password, 10),
      role: "default",
      display_name: "SCHAT 로컬 평가 계정",
      must_change_password: false,
    },
    select: { id: true, username: true, role: true, display_name: true },
  });
  await prisma.workspace_users.create({
    data: { user_id: user.id, workspace_id: workspace.id },
  });
  const token = makeJWT({ id: user.id, username: user.username }, "30m");
  process.stdout.write(JSON.stringify({ token, user }));
}

async function cleanup() {
  const userId = Number(process.env.SCHAT_TEMP_USER_ID || 0);
  if (!userId) throw new Error("missing_temp_user_id");
  await prisma.users.deleteMany({ where: { id: userId } });
  const remainingUsers = await prisma.users.count({ where: { id: userId } });
  const remainingThreads = await prisma.workspace_threads.count({
    where: { user_id: userId },
  });
  const remainingChats = await prisma.workspace_chats.count({
    where: { user_id: userId },
  });
  process.stdout.write(
    JSON.stringify({ remainingUsers, remainingThreads, remainingChats })
  );
}

async function cleanupOrphans() {
  const users = await prisma.users.findMany({
    where: { username: { startsWith: "schat_eval_" } },
    select: { id: true },
  });
  for (const user of users) await prisma.users.delete({ where: { id: user.id } });
  const remaining = await prisma.users.count({
    where: { username: { startsWith: "schat_eval_" } },
  });
  process.stdout.write(JSON.stringify({ removed: users.length, remaining }));
}

const action = process.argv[2];
(action === "create"
  ? create()
  : action === "cleanup"
    ? cleanup()
    : action === "cleanup-orphans"
      ? cleanupOrphans()
      : null)
  ?.catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
