// Resolves a role id to its display name (from the roles library). Shared by the
// cascade tree and the loop page so role tags read "Engineer", not "engineer".

import { useEffect, useMemo, useState } from 'react';
import { getRoles, type RoleDef } from '../../api-client/index';

export function useRoleLabel(): (roleId: string) => string {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  useEffect(() => {
    let active = true;
    getRoles()
      .then((r) => active && setRoles(r))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return useMemo(() => {
    const byId = new Map(roles.map((r) => [r.id, r.name] as const));
    return (roleId: string) => byId.get(roleId) ?? roleId.charAt(0).toUpperCase() + roleId.slice(1);
  }, [roles]);
}
