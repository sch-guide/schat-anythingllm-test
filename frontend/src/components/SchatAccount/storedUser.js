import { AUTH_USER } from "@/utils/constants";

// Keeps the stored session user in step with the server's view (name,
// department, role, first-login flag). Never stores a password or hash.
export function mergeStoredUser(profile) {
  if (!profile) return null;
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(AUTH_USER) || "{}") || {};
  } catch {}
  const next = {
    ...stored,
    id: profile.id ?? stored.id,
    username: profile.username ?? stored.username,
    role: profile.role ?? stored.role,
    name: profile.name,
    department: profile.department,
    employeeNumberMasked: profile.employeeNumberMasked,
    roleLabel: profile.roleLabel,
    mustChangePassword: !!profile.mustChangePassword,
  };
  delete next.password;
  window.localStorage.setItem(AUTH_USER, JSON.stringify(next));
  return next;
}
