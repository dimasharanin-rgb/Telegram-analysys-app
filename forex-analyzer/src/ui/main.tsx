import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "@/ui/components/layout/AppShell";
import { AppDataProvider } from "@/ui/hooks/useAppData";
import { LiveFeedProvider } from "@/ui/hooks/useLiveFeed";
import { AnalyzerPage } from "@/ui/pages/AnalyzerPage";
import { DashboardPage } from "@/ui/pages/DashboardPage";
import { JournalPage } from "@/ui/pages/JournalPage";
import { SettingsPage } from "@/ui/pages/SettingsPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppDataProvider>
        <LiveFeedProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="analyze" element={<AnalyzerPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>
        </Routes>
        </LiveFeedProvider>
      </AppDataProvider>
    </BrowserRouter>
  </StrictMode>,
);
