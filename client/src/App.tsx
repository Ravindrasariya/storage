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
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  Users,
  ShoppingCart,
  Building2,
  Landmark,
  FileSpreadsheet,
  TrendingUp,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import LotEntry from "@/pages/LotEntry";
import StockRegister from "@/pages/StockRegister";
import Analytics from "@/pages/Analytics";
import SalesHistory from "@/pages/SalesHistory";
import CashManagement from "@/pages/CashManagement";
import FarmerLedger from "@/pages/FarmerLedger";
import BuyerLedger from "@/pages/BuyerLedger";
import AssetRegister from "@/pages/AssetRegister";
import LiabilityRegister from "@/pages/LiabilityRegister";
import BalanceSheet from "@/pages/BalanceSheet";
import ProfitAndLoss from "@/pages/ProfitAndLoss";
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
    { href: "/farmer-ledger", label: t("farmerLedger"), icon: Users },
    { href: "/buyer-ledger", label: t("buyerLedger"), icon: ShoppingCart },
  ];

  const booksItems = [
    { href: "/assets", label: t("assetRegister") || "Asset Register", icon: Building2 },
    { href: "/liabilities", label: t("liabilityRegister") || "Liability Register", icon: Landmark },
    { href: "/balance-sheet", label: t("balanceSheet") || "Balance Sheet", icon: FileSpreadsheet },
    { href: "/profit-and-loss", label: t("profitAndLoss") || "Profit & Loss", icon: TrendingUp },
  ];

  const isBooksActive = booksItems.some(item => location === item.href);

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {navItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant={isActive ? "default" : "ghost"}
              size="sm"
              className={`gap-1.5 justify-start shrink-0 whitespace-nowrap text-[0.85rem] font-extrabold ${isActive ? "bg-chart-1 hover:bg-chart-1/90" : ""}`}
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

  const BooksDropdown = ({ onClick }: { onClick?: () => void }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={isBooksActive ? "default" : "ghost"}
          size="sm"
          className={`gap-1.5 justify-start shrink-0 whitespace-nowrap text-[0.85rem] font-extrabold ${isBooksActive ? "bg-chart-1 hover:bg-chart-1/90" : ""}`}
          data-testid="nav-books"
        >
          <BookOpen className="h-4 w-4" />
          {t("books") || "Books"}
          <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900 dark:text-amber-300 dark:border-amber-700">Beta</Badge>
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {booksItems.map((item) => {
          const isActive = location === item.href;
          return (
            <DropdownMenuItem key={item.href} asChild className={isActive ? "bg-accent" : ""}>
              <Link href={item.href} onClick={onClick}>
                <item.icon className="h-4 w-4 mr-2" />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const MobileBooksList = ({ onClick }: { onClick?: () => void }) => {
    const [booksOpen, setBooksOpen] = useState(false);
    return (
      <div>
        <Button
          variant={isBooksActive ? "default" : "ghost"}
          size="sm"
          className={`gap-1.5 justify-start shrink-0 whitespace-nowrap text-[0.85rem] font-extrabold w-full ${isBooksActive ? "bg-chart-1 hover:bg-chart-1/90" : ""}`}
          onClick={() => setBooksOpen(!booksOpen)}
          data-testid="nav-books-mobile"
        >
          <BookOpen className="h-4 w-4" />
          {t("books") || "Books"}
          <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900 dark:text-amber-300 dark:border-amber-700">Beta</Badge>
          <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${booksOpen ? "rotate-180" : ""}`} />
        </Button>
        {booksOpen && (
          <div className="ml-4 mt-1 flex flex-col gap-1">
            {booksItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className={`gap-1.5 justify-start shrink-0 whitespace-nowrap text-[0.8rem] font-semibold w-full ${isActive ? "bg-chart-1 hover:bg-chart-1/90" : ""}`}
                    onClick={onClick}
                    data-testid={`nav-${item.href.replace("/", "")}`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-chart-1">
            <Snowflake className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <div className="max-w-[100px] sm:max-w-none">
              <span className="font-bold text-sm sm:text-base leading-tight">{t("appTitle")}</span>
              <p className="text-[10px] text-muted-foreground leading-tight">
                by <span className="text-green-600 dark:text-green-400 font-medium">Krashu</span><span className="text-orange-500 dark:text-orange-400 font-medium">Ved</span>
              </p>
            </div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
          <NavLinks />
          <BooksDropdown />
        </nav>

        <div className="flex items-center gap-1.5 shrink-0">
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
                <MobileBooksList onClick={() => setMobileMenuOpen(false)} />
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
      <Route path="/farmer-ledger" component={FarmerLedger} />
      <Route path="/buyer-ledger" component={BuyerLedger} />
      <Route path="/assets" component={AssetRegister} />
      <Route path="/liabilities" component={LiabilityRegister} />
      <Route path="/balance-sheet" component={BalanceSheet} />
      <Route path="/profit-and-loss" component={ProfitAndLoss} />
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
