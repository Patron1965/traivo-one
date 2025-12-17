import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "../layout/AppSidebar";

export default function AppSidebarExample() {
  return (
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>
  );
}
