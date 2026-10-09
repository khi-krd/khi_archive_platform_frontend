import { AdminEntityPage } from '@/components/admin/AdminEntityPage'
import { AuthImageManager } from '@/components/admin/AuthImageManager'
import { KhiLogoManager } from '@/components/admin/KhiLogoManager'
import { SiteFontManager } from '@/components/admin/SiteFontManager'
import { StaticTextManager } from '@/components/admin/StaticTextManager'

function AdminSettingsPage() {
  return (
    <AdminEntityPage
      title="Settings"
      description="Platform branding, behavior, and defaults."
    >
      <KhiLogoManager />
      <AuthImageManager />
      <SiteFontManager />
      <StaticTextManager />
    </AdminEntityPage>
  )
}

export { AdminSettingsPage }
