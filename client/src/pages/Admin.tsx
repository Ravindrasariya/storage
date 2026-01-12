import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

  // Delete cold storage mutation
  const deleteStorageMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await adminApiRequest("DELETE", `/api/admin/cold-storages/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cold-storages"] });
      toast({ title: "Success", description: "Cold storage deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete cold storage", variant: "destructive" });
    },
  });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-chart-1" />
            Admin Panel
          </h1>
          <p className="text-muted-foreground">Manage cold storages and users</p>
        </div>
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
      </div>

      <div className="space-y-3">
        {coldStorages.map((storage) => (
          <ColdStorageRow
            key={storage.id}
            storage={storage}
            isExpanded={expandedStorages.has(storage.id)}
            isEditing={editingStorage === storage.id}
            onToggleExpand={() => toggleExpand(storage.id)}
            onEdit={() => setEditingStorage(storage.id)}
            onCancelEdit={() => setEditingStorage(null)}
            onSave={(data) => updateStorageMutation.mutate({ id: storage.id, data })}
            onDelete={() => {
              if (confirm("Are you sure you want to delete this cold storage? This will also delete all associated users.")) {
                deleteStorageMutation.mutate(storage.id);
              }
            }}
            isSaving={updateStorageMutation.isPending}
          />
        ))}

        {coldStorages.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No cold storages found. Click "Add Cold Storage" to create one.
          </Card>
        )}
      </div>
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
  onDelete: () => void;
  isSaving: boolean;
}

function ColdStorageRow({
  storage,
  isExpanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  isSaving,
}: ColdStorageRowProps) {
  const [formData, setFormData] = useState({
    name: storage.name,
    address: storage.address || "",
    tehsil: storage.tehsil || "",
    district: storage.district || "",
    state: storage.state || "",
    pincode: storage.pincode || "",
  });

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <div className="flex items-center justify-between p-4">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-left flex-1" data-testid={`toggle-storage-${storage.id}`}>
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <h3 className="font-semibold">{storage.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {storage.address ? `${storage.address}, ` : ""}
                  {storage.district || "No address"}, {storage.state || ""}
                </p>
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-storage-${storage.id}`}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-storage-${storage.id}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
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
                <div>
                  <span className="text-muted-foreground">Capacity:</span>{" "}
                  <span className="font-medium">{storage.totalCapacity.toLocaleString()} bags</span>
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
    totalCapacity: 10000,
    waferRate: 50,
    seedRate: 55,
    waferColdCharge: 45,
    waferHammali: 5,
    seedColdCharge: 50,
    seedHammali: 5,
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
        <div>
          <Label>Total Capacity (bags) *</Label>
          <Input
            type="number"
            value={formData.totalCapacity}
            onChange={(e) => setFormData((p) => ({ ...p, totalCapacity: parseInt(e.target.value) || 0 }))}
            required
          />
        </div>
        <div>
          <Label>Wafer Rate *</Label>
          <Input
            type="number"
            value={formData.waferRate}
            onChange={(e) => setFormData((p) => ({ ...p, waferRate: parseFloat(e.target.value) || 0 }))}
            required
          />
        </div>
        <div>
          <Label>Seed Rate *</Label>
          <Input
            type="number"
            value={formData.seedRate}
            onChange={(e) => setFormData((p) => ({ ...p, seedRate: parseFloat(e.target.value) || 0 }))}
            required
          />
        </div>
      </div>
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
