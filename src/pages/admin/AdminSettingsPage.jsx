import { AdminEntityPage } from '@/components/admin/AdminEntityPage'
import { AuthImageManager } from '@/components/admin/AuthImageManager'
import { KhiLogoManager } from '@/components/admin/KhiLogoManager'
import { SiteFontManager } from '@/components/admin/SiteFontManager'

function AdminSettingsPage() {
  return (
    <AdminEntityPage
      title="Settings"
      description="Platform branding, behavior, and defaults."
    >
      <KhiLogoManager />
      <AuthImageManager />
      <SiteFontManager />
    </AdminEntityPage>
  )
}

export { AdminSettingsPage }
