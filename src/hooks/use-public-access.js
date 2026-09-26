import { getStoredToken } from '@/lib/auth-storage'
import { getAccountArea } from '@/lib/account-role'
import { useCurrentProfile } from '@/hooks/use-current-profile'

// Public routes are shared by anonymous visitors and signed-in accounts.  A
// stored token means the profile hook still has to resolve before we choose an
// API: firing the guest request first would briefly hide private records (and
// can turn a valid staff deep-link into a guest 404).
export function usePublicAccess() {
  const profile = useCurrentProfile()
  const hasSession = Boolean(getStoredToken())
  const accountArea = getAccountArea(profile?.role)
  const isStaff = accountArea === 'admin' || accountArea === 'employee'
  // The complete internal ledger is ADMIN-only on public pages — employees
  // still fetch through the staff API (they can preview private records),
  // but the rendered field set drops to the guest whitelist.
  const isAdmin = accountArea === 'admin'

  return {
    profile,
    accountArea,
    isStaff,
    isAdmin,
    ready: !hasSession || Boolean(profile),
  }
}
