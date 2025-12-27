import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import ResourceFocusPage from "@/pages/ResourceFocusPage";

export default function ResourceFocusApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ResourceFocusPage />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
