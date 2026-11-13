import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import type { LxdAuthGroup } from "types/permissions";
import { fetchGroups } from "api/auth-groups";

export const useAuthGroups = (
  enabled = true,
): UseQueryResult<LxdAuthGroup[]> => {
  return useQuery({
    queryKey: [queryKeys.authGroups],
    queryFn: async () => fetchGroups(),
    enabled,
  });
};
