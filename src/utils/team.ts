import type { UserProfileWithId } from '../types';

// Developers named in `memberOrder` come first, in that order. Any developer
// not yet in the saved order (e.g. a brand-new teammate) is appended
// alphabetically by name. Uids in `memberOrder` that no longer belong to a
// developer (removed/role-changed) are ignored.
export function orderDevelopers(
  devs: UserProfileWithId[],
  memberOrder: string[],
): UserProfileWithId[] {
  const indexByUid = new Map(memberOrder.map((uid, index) => [uid, index]));

  const ordered = devs
    .filter((dev) => indexByUid.has(dev.id))
    .sort((a, b) => indexByUid.get(a.id)! - indexByUid.get(b.id)!);

  const unordered = devs
    .filter((dev) => !indexByUid.has(dev.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...ordered, ...unordered];
}

// Sorts reports using the same team order the "Team" list uses, keyed by
// `userId`. Reports from users who are not in `orderedUserIds` (e.g. no
// longer a developer) sort last, alphabetically by userId.
export function orderReportsByTeam<T extends { userId: string }>(
  reports: T[],
  orderedUserIds: string[],
): T[] {
  const indexByUserId = new Map(orderedUserIds.map((userId, index) => [userId, index]));

  return [...reports].sort((a, b) => {
    const indexA = indexByUserId.get(a.userId) ?? Number.POSITIVE_INFINITY;
    const indexB = indexByUserId.get(b.userId) ?? Number.POSITIVE_INFINITY;

    if (indexA !== indexB) {
      return indexA - indexB;
    }

    return a.userId.localeCompare(b.userId);
  });
}
