export const sectionPermissions: Record<string, string> = {
  dashboard: "dashboard.view", members: "members.manage", staff: "staff.manage", roles: "roles.manage",
  reports: "reports.view", content: "content.manage", coupons: "coupons.manage", bookings: "bookings.manage",
  trainers: "trainers.manage", audit: "settings.manage", security: "settings.manage", system: "settings.manage", analysis: "settings.manage",
  // Big Screen program guide (app content) and Buffet Rank / Open Run (bookings at the club).
  bigscreen: "content.manage", rank: "bookings.manage",
  // Classes (programs, timetable, class rosters) run with bookings; Promotion (weekly deals, Member
  // packages) is app content.
  classes: "bookings.manage", promotions: "content.manage",
  // Groups (ก๊วน) made by members: their members, photos and descriptions, and the group Coins.
  groups: "members.manage",
};

// Permissions for /api/admin/<resource> (any one is enough); null means the resource is not exposed.
const routePermissions: Record<string, string[]> = {
  members: ["members.manage"], bookings: ["bookings.manage"], courts: ["bookings.manage"], content: ["content.manage"],
  coupons: ["coupons.manage"], trainers: ["trainers.manage"], uploads: ["trainers.manage", "content.manage"],
  payments: ["payments.manage"], sales: ["sales.manage"], staff: ["staff.manage"], roles: ["roles.manage"],
  qr: ["bookings.manage", "coupons.manage", "payments.manage"], profile: [], dashboard: ["dashboard.view"],
  // Receipts are printed at the counter (sales), by finance (payments) and for reports.
  receipts: ["payments.manage", "sales.manage", "reports.view"], reports: ["reports.view", "payments.manage"],
  "screen-programs": ["content.manage"], rank: ["bookings.manage"], sports: ["bookings.manage"],
  classes: ["bookings.manage"], promotions: ["content.manage"], "ppa-members": ["members.manage"],
  groups: ["members.manage"],
};

export function requiredPermissions(resource: string, method: string) {
  // Counter staff (sales.manage) look members up and see their rights; editing stays with members.manage.
  if (resource === "members" && method === "GET") return ["members.manage", "sales.manage"];
  return routePermissions[resource] ?? null;
}

// Slips are served only to staff with payments.manage (see /api/admin/payments/slip).
export function canViewSlips(admin: { roleCode?: string; permissionCodes?: string[] } | null | undefined) {
  return Boolean(admin && (admin.roleCode === "super_admin" || admin.permissionCodes?.includes("payments.manage")));
}

export function canAccessSection(section: string, can: (permission: string) => boolean) {
  if (section === "members") return ["members.manage", "sales.manage"].some(can);
  return section === "scanner" ? ["bookings.manage", "coupons.manage", "payments.manage"].some(can) : Boolean(sectionPermissions[section] && can(sectionPermissions[section]));
}
