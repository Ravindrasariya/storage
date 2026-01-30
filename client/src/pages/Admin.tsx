import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Lock,
  Plus,
  ChevronDown,
  ChevronRight,
  Edit,
  Trash2,
  Users,
  Building2,
  Key,
  Save,
  X,
  LogOut,
  Archive,
  RotateCcw,
  Power,
  PowerOff,
  Undo2,
} from "lucide-react";
import type { ColdStorage, ColdStorageUser } from "@shared/schema";

// Store admin token in memory (cleared on page refresh)
let adminToken: string | null = null;

export function getAdminToken() {
  return adminToken;
}

export function setAdminToken(token: string | null) {
  adminToken = token;
}

// Helper to make authenticated admin API requests
async function adminApiRequest(method: string, url: string, body?: any) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response;
}

export default function Admin() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(!!adminToken);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (pwd: string) => {
      const response = await apiRequest("POST", "/api/admin/login", { password: pwd });
      return response.json();
    },
    onSuccess: (data) => {
      setAdminToken(data.token);
      setIsAuthenticated(true);
      setLoginError("");
    },
    onError: () => {
      setLoginError("Invalid password");
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(password);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6">
          <div className="text-center mb-6">
            <Lock className="h-12 w-12 mx-auto text-chart-1 mb-2" />
            <h1 className="text-2xl font-bold">Admin Access</h1>
            <p className="text-muted-foreground">Enter password to continue</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                data-testid="input-admin-password"
              />
            </div>
            {loginError && (
              <p className="text-sm text-destructive">{loginError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-admin-login"
            >
              {loginMutation.isPending ? "Logging in..." : "Login"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { toast } = useToast();
  const [expandedStorages, setExpandedStorages] = useState<Set<string>>(new Set());
  const [editingStorage, setEditingStorage] = useState<string | null>(null);
  const [addStorageOpen, setAddStorageOpen] = useState(false);

  // Fetch cold storages
  const { data: coldStorages = [], isLoading } = useQuery<ColdStorage[]>({
    queryKey: ["/api/admin/cold-storages"],
    queryFn: async () => {
      const response = await adminApiRequest("GET", "/api/admin/cold-storages");
      return response.json();
    },
  });

  // Create cold storage mutation
  const createStorageMutation = useMutation({
    mutationFn: async (data: Partial<ColdStorage>) => {
      const response = await adminApiRequest("POST", "/api/admin/cold-storages", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages"] });
      setAddStorageOpen(false);
      toast({ title: "Success", description: "Cold storage created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create cold storage", variant: "destructive" });
    },
  });

  // Update cold storage mutation
  const updateStorageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ColdStorage> }) => {
      const response = await adminApiRequest("PATCH", `/api/admin/cold-storages/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages"] });
      setEditingStorage(null);
      toast({ title: "Success", description: "Cold storage updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update cold storage", variant: "destructive" });
    },
  });

  // Update cold storage status mutation (with password verification)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, adminPassword }: { id: string; status: string; adminPassword: string }) => {
      const response = await adminApiRequest("POST", `/api/admin/cold-storages/${id}/status`, { status, adminPassword });
      return response.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages"] });
      const statusMessages: Record<string, string> = {
        active: "Cold storage activated successfully",
        inactive: "Cold storage made inactive successfully",
        archived: "Cold storage archived successfully",
      };
      toast({ title: "Success", description: statusMessages[status] || "Status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
    },
  });

  // Reset cold storage mutation (factory reset with TWO password verification)
  const resetStorageMutation = useMutation({
    mutationFn: async ({ id, adminPassword, resetPassword }: { id: string; adminPassword: string; resetPassword: string }) => {
      const response = await adminApiRequest("POST", `/api/admin/cold-storages/${id}/reset`, { adminPassword, resetPassword });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages"] });
      toast({ title: "Success", description: "Cold storage reset successfully. All data has been deleted." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reset cold storage", variant: "destructive" });
    },
  });

  // Separate storages by status
  const activeStorages = coldStorages.filter(s => s.status === 'active' || !s.status);
  const inactiveStorages = coldStorages.filter(s => s.status === 'inactive');
  const archivedStorages = coldStorages.filter(s => s.status === 'archived');

  const toggleExpand = (id: string) => {
    setExpandedStorages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLogout = () => {
    setAdminToken(null);
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded w-48" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-chart-1" />
            Admin Panel
          </h1>
          <p className="text-muted-foreground">Manage cold storages and users</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={addStorageOpen} onOpenChange={setAddStorageOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-cold-storage">
                <Plus className="h-4 w-4 mr-2" />
                Add Cold Storage
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Cold Storage</DialogTitle>
            </DialogHeader>
            <AddColdStorageForm
              onSubmit={(data) => createStorageMutation.mutate(data)}
              isPending={createStorageMutation.isPending}
              onCancel={() => setAddStorageOpen(false)}
            />
          </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            onClick={handleLogout}
            data-testid="button-admin-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Active Cold Storages */}
      {activeStorages.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Power className="h-5 w-5 text-green-600" />
            Active Cold Storages ({activeStorages.length})
          </h2>
          {activeStorages.map((storage) => (
            <ColdStorageRow
              key={storage.id}
              storage={storage}
              isExpanded={expandedStorages.has(storage.id)}
              isEditing={editingStorage === storage.id}
              onToggleExpand={() => toggleExpand(storage.id)}
              onEdit={() => setEditingStorage(storage.id)}
              onCancelEdit={() => setEditingStorage(null)}
              onSave={(data) => updateStorageMutation.mutate({ id: storage.id, data })}
              onStatusChange={(status, password) => updateStatusMutation.mutate({ id: storage.id, status, adminPassword: password })}
              onReset={(adminPassword, resetPassword) => resetStorageMutation.mutate({ id: storage.id, adminPassword, resetPassword })}
              isSaving={updateStorageMutation.isPending}
              isStatusChanging={updateStatusMutation.isPending}
              isResetting={resetStorageMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Inactive Cold Storages */}
      {inactiveStorages.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PowerOff className="h-5 w-5 text-yellow-600" />
            Inactive Cold Storages ({inactiveStorages.length})
          </h2>
          {inactiveStorages.map((storage) => (
            <ColdStorageRow
              key={storage.id}
              storage={storage}
              isExpanded={expandedStorages.has(storage.id)}
              isEditing={editingStorage === storage.id}
              onToggleExpand={() => toggleExpand(storage.id)}
              onEdit={() => setEditingStorage(storage.id)}
              onCancelEdit={() => setEditingStorage(null)}
              onSave={(data) => updateStorageMutation.mutate({ id: storage.id, data })}
              onStatusChange={(status, password) => updateStatusMutation.mutate({ id: storage.id, status, adminPassword: password })}
              onReset={(adminPassword, resetPassword) => resetStorageMutation.mutate({ id: storage.id, adminPassword, resetPassword })}
              isSaving={updateStorageMutation.isPending}
              isStatusChanging={updateStatusMutation.isPending}
              isResetting={resetStorageMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Archived Cold Storages */}
      {archivedStorages.length > 0 && (
        <div className="space-y-3 border-t pt-6 mt-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
            <Archive className="h-5 w-5" />
            Archived Cold Storages ({archivedStorages.length})
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            These cold storages have been archived. Users cannot log in until they are reinstated.
          </p>
          {archivedStorages.map((storage) => (
            <ColdStorageRow
              key={storage.id}
              storage={storage}
              isExpanded={expandedStorages.has(storage.id)}
              isEditing={editingStorage === storage.id}
              onToggleExpand={() => toggleExpand(storage.id)}
              onEdit={() => setEditingStorage(storage.id)}
              onCancelEdit={() => setEditingStorage(null)}
              onSave={(data) => updateStorageMutation.mutate({ id: storage.id, data })}
              onStatusChange={(status, password) => updateStatusMutation.mutate({ id: storage.id, status, adminPassword: password })}
              onReset={(adminPassword, resetPassword) => resetStorageMutation.mutate({ id: storage.id, adminPassword, resetPassword })}
              isSaving={updateStorageMutation.isPending}
              isStatusChanging={updateStatusMutation.isPending}
              isResetting={resetStorageMutation.isPending}
            />
          ))}
        </div>
      )}

      {coldStorages.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          No cold storages found. Click "Add Cold Storage" to create one.
        </Card>
      )}
    </div>
  );
}

interface ColdStorageRowProps {
  storage: ColdStorage;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: Partial<ColdStorage>) => void;
  onStatusChange: (status: string, password: string) => void;
  onReset: (adminPassword: string, resetPassword: string) => void;
  isSaving: boolean;
  isStatusChanging: boolean;
  isResetting: boolean;
}

function ColdStorageRow({
  storage,
  isExpanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onStatusChange,
  onReset,
  isSaving,
  isStatusChanging,
  isResetting,
}: ColdStorageRowProps) {
  const [formData, setFormData] = useState({
    name: storage.name,
    address: storage.address || "",
    tehsil: storage.tehsil || "",
    district: storage.district || "",
    state: storage.state || "",
    pincode: storage.pincode || "",
  });

  // Dialog states
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showInactiveDialog, setShowInactiveDialog] = useState(false);
  const [showActiveDialog, setShowActiveDialog] = useState(false);
  const [showReinstateDialog, setShowReinstateDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleSave = () => {
    onSave(formData);
  };

  const handleResetConfirm = () => {
    if (!adminPassword) {
      setPasswordError("Admin password is required");
      return;
    }
    if (!resetPassword) {
      setPasswordError("Reset password is required");
      return;
    }
    onReset(adminPassword, resetPassword);
    setShowResetDialog(false);
    setAdminPassword("");
    setResetPassword("");
    setPasswordError("");
  };

  const handleStatusConfirm = (newStatus: string) => {
    if (!adminPassword) {
      setPasswordError("Password is required");
      return;
    }
    onStatusChange(newStatus, adminPassword);
    setShowInactiveDialog(false);
    setShowActiveDialog(false);
    setShowReinstateDialog(false);
    setShowArchiveDialog(false);
    setAdminPassword("");
    setPasswordError("");
  };

  const status = storage.status || 'active';
  const isArchived = status === 'archived';
  const isInactive = status === 'inactive';
  const isActive = status === 'active';

  const getStatusBadge = () => {
    if (isArchived) return <Badge variant="secondary" className="bg-gray-500 text-white">Archived</Badge>;
    if (isInactive) return <Badge variant="secondary" className="bg-yellow-600 text-white">Inactive</Badge>;
    return <Badge variant="secondary" className="bg-green-600 text-white">Active</Badge>;
  };

  return (
    <Card className={`overflow-hidden ${isArchived ? 'opacity-70' : ''}`}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <div className="flex items-center justify-between p-4">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-left flex-1" data-testid={`toggle-storage-${storage.id}`}>
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
              <div className="flex items-center gap-2">
                <div>
                  <h3 className="font-semibold">{storage.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {storage.address ? `${storage.address}, ` : ""}
                    {storage.district || "No address"}, {storage.state || ""}
                  </p>
                </div>
                {getStatusBadge()}
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 flex-wrap">
            {!isEditing ? (
              <>
                {/* Edit button - always available */}
                <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-storage-${storage.id}`}>
                  <Edit className="h-4 w-4" />
                </Button>

                {/* Active storage actions */}
                {isActive && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowResetDialog(true)}
                      className="text-red-600 hover:text-red-700"
                      data-testid={`button-reset-storage-${storage.id}`}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Reset
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowInactiveDialog(true)}
                      className="text-yellow-600 hover:text-yellow-700"
                      data-testid={`button-inactive-storage-${storage.id}`}
                    >
                      <PowerOff className="h-4 w-4 mr-1" />
                      Inactive
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowArchiveDialog(true)}
                      className="text-gray-600 hover:text-gray-700"
                      data-testid={`button-archive-storage-${storage.id}`}
                    >
                      <Archive className="h-4 w-4 mr-1" />
                      Archive
                    </Button>
                  </>
                )}

                {/* Inactive storage actions */}
                {isInactive && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowActiveDialog(true)}
                      className="text-green-600 hover:text-green-700"
                      data-testid={`button-activate-storage-${storage.id}`}
                    >
                      <Power className="h-4 w-4 mr-1" />
                      Activate
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowArchiveDialog(true)}
                      className="text-gray-600 hover:text-gray-700"
                      data-testid={`button-archive-storage-${storage.id}`}
                    >
                      <Archive className="h-4 w-4 mr-1" />
                      Archive
                    </Button>
                  </>
                )}

                {/* Archived storage actions */}
                {isArchived && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowReinstateDialog(true)}
                    className="text-green-600 hover:text-green-700"
                    data-testid={`button-reinstate-storage-${storage.id}`}
                  >
                    <Undo2 className="h-4 w-4 mr-1" />
                    Reinstate
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon" onClick={handleSave} disabled={isSaving}>
                  <Save className="h-4 w-4 text-green-600" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onCancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Reset Confirmation Dialog - Requires TWO passwords */}
        <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600">Factory Reset - {storage.name}</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL data for this cold storage including:
                <ul className="list-disc ml-6 mt-2 space-y-1">
                  <li>All lots and their history</li>
                  <li>All sales records</li>
                  <li>All chambers and floors</li>
                  <li>All cash flow records</li>
                  <li>All bill number counters (reset to 1)</li>
                </ul>
                <p className="mt-3 font-semibold text-red-600">This action cannot be undone!</p>
                <p className="mt-2 text-sm">Two passwords required for extra safety.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Password 1: Admin Password</Label>
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(""); }}
                  placeholder="Enter admin password"
                  data-testid="input-reset-admin-password"
                />
              </div>
              <div className="space-y-2">
                <Label>Password 2: Reset Password</Label>
                <Input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => { setResetPassword(e.target.value); setPasswordError(""); }}
                  placeholder="Enter reset password"
                  data-testid="input-reset-password"
                />
              </div>
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setAdminPassword(""); setResetPassword(""); setPasswordError(""); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleResetConfirm} 
                className="bg-red-600 hover:bg-red-700"
                disabled={isResetting}
              >
                {isResetting ? "Resetting..." : "Reset All Data"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Make Inactive Confirmation Dialog */}
        <AlertDialog open={showInactiveDialog} onOpenChange={setShowInactiveDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Make Inactive - {storage.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Making this cold storage inactive will prevent all users from logging in and using the account.
                All data will be preserved and can be accessed once the account is activated again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 mt-2">
              <Label>Enter Admin Password to confirm</Label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(""); }}
                placeholder="Admin password"
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setAdminPassword(""); setPasswordError(""); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => handleStatusConfirm('inactive')} 
                className="bg-yellow-600 hover:bg-yellow-700"
                disabled={isStatusChanging}
              >
                {isStatusChanging ? "Processing..." : "Make Inactive"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Activate Confirmation Dialog */}
        <AlertDialog open={showActiveDialog} onOpenChange={setShowActiveDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Activate - {storage.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Activating this cold storage will allow users to log in and use the account.
                All existing data will be available.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 mt-2">
              <Label>Enter Admin Password to confirm</Label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(""); }}
                placeholder="Admin password"
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setAdminPassword(""); setPasswordError(""); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => handleStatusConfirm('active')} 
                className="bg-green-600 hover:bg-green-700"
                disabled={isStatusChanging}
              >
                {isStatusChanging ? "Processing..." : "Activate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reinstate Confirmation Dialog */}
        <AlertDialog open={showReinstateDialog} onOpenChange={setShowReinstateDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reinstate - {storage.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Reinstating this cold storage will restore it to active status. 
                All existing data will be available and users will be able to log in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 mt-2">
              <Label>Enter Admin Password to confirm</Label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(""); }}
                placeholder="Admin password"
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setAdminPassword(""); setPasswordError(""); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => handleStatusConfirm('active')} 
                className="bg-green-600 hover:bg-green-700"
                disabled={isStatusChanging}
              >
                {isStatusChanging ? "Processing..." : "Reinstate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Archive Confirmation Dialog */}
        <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive - {storage.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Archiving this cold storage will prevent all users from logging in.
                All data will be preserved and the storage will appear in the Archived section.
                You can reinstate it later if needed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 mt-2">
              <Label>Enter Admin Password to confirm</Label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(""); }}
                placeholder="Admin password"
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setAdminPassword(""); setPasswordError(""); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => handleStatusConfirm('archived')} 
                className="bg-gray-600 hover:bg-gray-700"
                disabled={isStatusChanging}
              >
                {isStatusChanging ? "Processing..." : "Archive"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <CollapsibleContent>
          <div className="border-t p-4 space-y-6">
            {isEditing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Cold Storage Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Tehsil</Label>
                  <Input
                    value={formData.tehsil}
                    onChange={(e) => setFormData((p) => ({ ...p, tehsil: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>District</Label>
                  <Input
                    value={formData.district}
                    onChange={(e) => setFormData((p) => ({ ...p, district: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>State</Label>
                  <Input
                    value={formData.state}
                    onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Pincode</Label>
                  <Input
                    value={formData.pincode}
                    onChange={(e) => setFormData((p) => ({ ...p, pincode: e.target.value }))}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Address:</span>{" "}
                  <span className="font-medium">{storage.address || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tehsil:</span>{" "}
                  <span className="font-medium">{storage.tehsil || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">District:</span>{" "}
                  <span className="font-medium">{storage.district || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">State:</span>{" "}
                  <span className="font-medium">{storage.state || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pincode:</span>{" "}
                  <span className="font-medium">{storage.pincode || "-"}</span>
                </div>
              </div>
            )}

            <UserManagement coldStorageId={storage.id} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

interface AddColdStorageFormProps {
  onSubmit: (data: Partial<ColdStorage>) => void;
  isPending: boolean;
  onCancel: () => void;
}

function AddColdStorageForm({ onSubmit, isPending, onCancel }: AddColdStorageFormProps) {
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    tehsil: "",
    district: "",
    state: "",
    pincode: "",
    linkedPhones: [] as string[],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Cold Storage Name *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
            required
          />
        </div>
        <div className="col-span-2">
          <Label>Address</Label>
          <Input
            value={formData.address}
            onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
          />
        </div>
        <div>
          <Label>Tehsil</Label>
          <Input
            value={formData.tehsil}
            onChange={(e) => setFormData((p) => ({ ...p, tehsil: e.target.value }))}
          />
        </div>
        <div>
          <Label>District</Label>
          <Input
            value={formData.district}
            onChange={(e) => setFormData((p) => ({ ...p, district: e.target.value }))}
          />
        </div>
        <div>
          <Label>State</Label>
          <Input
            value={formData.state}
            onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
          />
        </div>
        <div>
          <Label>Pincode</Label>
          <Input
            value={formData.pincode}
            onChange={(e) => setFormData((p) => ({ ...p, pincode: e.target.value }))}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Capacity and rates can be configured from the main dashboard after creation.
      </p>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create Cold Storage"}
        </Button>
      </div>
    </form>
  );
}

interface UserManagementProps {
  coldStorageId: string;
}

function UserManagement({ coldStorageId }: UserManagementProps) {
  const { toast } = useToast();
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // Fetch users
  const { data: users = [] } = useQuery<ColdStorageUser[]>({
    queryKey: ["/api/admin/cold-storages", coldStorageId, "users"],
    queryFn: async () => {
      const response = await adminApiRequest("GET", `/api/admin/cold-storages/${coldStorageId}/users`);
      return response.json();
    },
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: { name: string; mobileNumber: string; password: string; accessType: string }) => {
      const response = await adminApiRequest("POST", `/api/admin/cold-storages/${coldStorageId}/users`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages", coldStorageId, "users"] });
      setAddUserOpen(false);
      toast({ title: "Success", description: "User created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create user", variant: "destructive" });
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await adminApiRequest("DELETE", `/api/admin/users/${userId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages", coldStorageId, "users"] });
      toast({ title: "Success", description: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const response = await adminApiRequest("POST", `/api/admin/users/${userId}/reset-password`, { newPassword: password });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages", coldStorageId, "users"] });
      setResetPasswordUserId(null);
      setNewPassword("");
      toast({ title: "Success", description: "Password reset successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reset password", variant: "destructive" });
    },
  });

  // Update user access type mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, accessType }: { userId: string; accessType: string }) => {
      const response = await adminApiRequest("PATCH", `/api/admin/users/${userId}`, { accessType });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages", coldStorageId, "users"] });
      toast({ title: "Success", description: "User updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" />
          Users
        </h4>
        <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
            </DialogHeader>
            <AddUserForm
              onSubmit={(data) => createUserMutation.mutate(data)}
              isPending={createUserMutation.isPending}
              onCancel={() => setAddUserOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users added yet.</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex-1">
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.mobileNumber}</p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={user.accessType}
                  onValueChange={(value) => updateUserMutation.mutate({ userId: user.id, accessType: value })}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">View</SelectItem>
                    <SelectItem value="edit">Edit</SelectItem>
                  </SelectContent>
                </Select>

                {resetPasswordUserId === user.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      type="password"
                      placeholder="New password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-32 h-8"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => resetPasswordMutation.mutate({ userId: user.id, password: newPassword })}
                      disabled={!newPassword || resetPasswordMutation.isPending}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetPasswordUserId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setResetPasswordUserId(user.id)}
                    title="Reset Password"
                  >
                    <Key className="h-4 w-4" />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm("Delete this user?")) {
                      deleteUserMutation.mutate(user.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AddUserFormProps {
  onSubmit: (data: { name: string; mobileNumber: string; password: string; accessType: string }) => void;
  isPending: boolean;
  onCancel: () => void;
}

function AddUserForm({ onSubmit, isPending, onCancel }: AddUserFormProps) {
  const [formData, setFormData] = useState({
    name: "",
    mobileNumber: "",
    password: "",
    accessType: "view",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Name *</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          required
        />
      </div>
      <div>
        <Label>Mobile Number *</Label>
        <Input
          value={formData.mobileNumber}
          onChange={(e) => setFormData((p) => ({ ...p, mobileNumber: e.target.value }))}
          placeholder="10-digit number"
          maxLength={10}
          required
        />
      </div>
      <div>
        <Label>Password *</Label>
        <Input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
          required
          minLength={4}
        />
      </div>
      <div>
        <Label>Access Type *</Label>
        <Select
          value={formData.accessType}
          onValueChange={(value) => setFormData((p) => ({ ...p, accessType: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">View Only</SelectItem>
            <SelectItem value="edit">Edit Access</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add User"}
        </Button>
      </div>
    </form>
  );
}
