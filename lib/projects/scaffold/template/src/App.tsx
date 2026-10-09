import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/plexo-react";
import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import { designRoutes } from "./plexo-canvas/routes";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {designRoutes.map(({ path, Component }) => <Route key={path} path={path} element={<Component />} />)}
            <Route path="/" element={<Index />} />
            {/* Add new routes above the catch-all "*" route. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
