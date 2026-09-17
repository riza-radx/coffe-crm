export const clientKeys = {
  all: ["clients"] as const,
  lists: () => [...clientKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...clientKeys.lists(), params] as const,
  detail: (id: string) => [...clientKeys.all, "detail", id] as const,
};

export const contractKeys = {
  all: ["contracts"] as const,
  lists: () => [...contractKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...contractKeys.lists(), params] as const,
  detail: (id: string) => [...contractKeys.all, "detail", id] as const,
};

export const billKeys = {
  all: ["bills"] as const,
  lists: () => [...billKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...billKeys.lists(), params] as const,
  detail: (id: string) => [...billKeys.all, "detail", id] as const,
};

export const commissionKeys = {
  all: ["commissions"] as const,
  lists: () => [...commissionKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...commissionKeys.lists(), params] as const,
  detail: (id: string) => [...commissionKeys.all, "detail", id] as const,
};

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => [...notificationKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...notificationKeys.lists(), params] as const,
};

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditLogKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) => [...auditLogKeys.lists(), params] as const,
};
