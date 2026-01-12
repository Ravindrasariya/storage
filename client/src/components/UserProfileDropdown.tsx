import { User, LogOut, Building2, Phone, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

interface UserProfileDropdownProps {
  user: {
    id: string;
    name: string;
    mobileNumber: string;
    accessType: string;
  };
  coldStorage: {
    id: string;
    name: string;
    address?: string;
    tehsil?: string;
    district?: string;
    state?: string;
    pincode?: string;
  };
  onLogout: () => void;
}

export function UserProfileDropdown({ user, coldStorage, onLogout }: UserProfileDropdownProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-user-profile">
          <User className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3 py-2">
            <div className="h-10 w-10 rounded-full bg-chart-1/10 flex items-center justify-center">
              <UserCircle className="h-6 w-6 text-chart-1" />
            </div>
            <div className="flex flex-col">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {user.accessType === "edit" ? t("editAccess") || "Edit Access" : t("viewOnly") || "View Only"}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        <div className="px-2 py-2 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <Phone className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{user.mobileNumber}</span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {t("coldStorageDetails") || "Cold Storage Details"}
        </DropdownMenuLabel>
        
        <div className="px-2 py-2 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">{coldStorage.name}</span>
              {coldStorage.address && (
                <span className="text-xs text-muted-foreground">{coldStorage.address}</span>
              )}
              {(coldStorage.tehsil || coldStorage.district) && (
                <span className="text-xs text-muted-foreground">
                  {[coldStorage.tehsil, coldStorage.district].filter(Boolean).join(", ")}
                </span>
              )}
              {(coldStorage.state || coldStorage.pincode) && (
                <span className="text-xs text-muted-foreground">
                  {[coldStorage.state, coldStorage.pincode].filter(Boolean).join(" - ")}
                </span>
              )}
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onLogout}
          className="text-destructive focus:text-destructive cursor-pointer"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {t("logout") || "Logout"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
