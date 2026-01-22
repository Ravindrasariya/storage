import { Switch, Route, Link, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  PlusCircle,
  Search,
  BarChart3,
  Menu,
  Snowflake,
  History,
  Banknote,
  Loader2,
} from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import LotEntry from "@/pages/LotEntry";
import StockRegister from "@/pages/StockRegister";
import Analytics from "@/pages/Analytics";
import SalesHistory from "@/pages/SalesHistory";
import CashManagement from "@/pages/CashManagement";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { useState, useCallback } from "react";

function Navigation() {
  const { t } = useI18n();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, coldStorage, logout } = useAuth();

  const navItems = [
    { href: "/", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/new-lot", label: t("newLot"), icon: PlusCircle },
    { href: "/stock-register", label: t("stockRegister"), icon: Search },
    { href: "/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/sales-history", label: t("salesHistory"), icon: History },
    { href: "/cash-management", label: t("cashManagement"), icon: Banknote },
  ];

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {navItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant={isActive ? "default" : "ghost"}
              className={`gap-2 justify-start w-full sm:w-auto ${isActive ? "bg-chart-1 hover:bg-chart-1/90" : ""}`}
              onClick={onClick}
              data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Button>
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between gap-4 px-4 py-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2 text-chart-1">
            <Snowflake className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <div>
              <span className="font-bold text-sm sm:text-lg leading-tight">{t("appTitle")}</span>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                by <span className="text-green-600 dark:text-green-400 font-medium">Krashu</span><span className="text-orange-500 dark:text-orange-400 font-medium">Ved</span>
              </p>
            </div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          <NavLinks />
        </nav>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          
          {user && coldStorage && (
            <UserProfileDropdown
              user={user}
              coldStorage={coldStorage}
              onLogout={logout}
            />
          )}
          
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[320px]">
              <div className="flex flex-col gap-2 mt-6 pr-4">
                <NavLinks onClick={() => setMobileMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function ProtectedRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/new-lot" component={LotEntry} />
      <Route path="/stock-register" component={StockRegister} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/sales-history" component={SalesHistory} />
      <Route path="/cash-management" component={CashManagement} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navigation />
      <main className="flex-1">
        <ProtectedRoutes />
      </main>
      <Footer />
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const [location] = useLocation();

  const handleLoginSuccess = useCallback((user: any, coldStorage: any, token: string) => {
    login(user, coldStorage, token);
    // Hard refresh to clear any cached state
    window.location.href = "/";
  }, [login]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-chart-1" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Allow admin page without authentication
  if (location === "/admin") {
    return <Admin />;
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Show authenticated app
  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <TooltipProvider>
              <AppContent />
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
