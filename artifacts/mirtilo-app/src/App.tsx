import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChecklistModal } from "@/components/ChecklistModal";
import { ScaleProvider } from "@/hooks/use-scale";

// Pages
import WeighingPage from "@/pages/WeighingPage";
import RankingPage from "@/pages/RankingPage";
import WorkersPage from "@/pages/WorkersPage";
import AttendancePage from "@/pages/AttendancePage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={WeighingPage} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/ranking" component={RankingPage} />
      <Route path="/workers" component={WorkersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ScaleProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            {/* Top level checklist modal forces validation on startup */}
            <ChecklistModal />
            <Router />
          </WouterRouter>
          <Toaster />
        </ScaleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
