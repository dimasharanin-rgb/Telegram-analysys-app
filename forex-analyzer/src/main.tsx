import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { AppDataProvider } from "@/hooks/useAppData";
import { AnalyzerPage } from "@/pages/AnalyzerPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { JournalPage } from "@/pages/JournalPage";
import { SettingsPage } from "@/pages/SettingsPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppDataProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="analyze" element={<AnalyzerPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>
        </Routes>
      </AppDataProvider>
    </BrowserRouter>
  </StrictMode>,
);
